const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 300;
const MAX_SENSES = 40;
const REQUEST_TIMEOUT_MS = 7000;
const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const lookupCache = new Map();
const translationCache = new Map();

class UpstreamError extends Error {
    constructor(service) {
        super(`${service} is temporarily unavailable. Please try again.`);
        this.name = 'UpstreamError';
        this.statusCode = 503;
    }
}

const clean = (value, max = 1000) => String(value ?? '').trim().slice(0, max);

const cleanDictionaryText = (value, max = 1000) => {
    const entities = {
        amp: '&',
        apos: "'",
        nbsp: ' ',
        copy: '(c)',
        gt: '>',
        ldquo: '"',
        lsquo: "'",
        lt: '<',
        mdash: '-',
        ndash: '-',
        quot: '"',
        rdquo: '"',
        rsquo: "'",
        trade: '(tm)'
    };

    return String(value ?? '')
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&#x([0-9a-f]{1,6});/gi, (_, code) => {
            const point = Number.parseInt(code, 16);
            return point <= 0x10ffff ? String.fromCodePoint(point) : ' ';
        })
        .replace(/&#(\d{1,7});/g, (_, code) => {
            const point = Number.parseInt(code, 10);
            return point <= 0x10ffff ? String.fromCodePoint(point) : ' ';
        })
        .replace(/&([a-z]+);/gi, (match, name) => entities[name.toLowerCase()] ?? match)
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max);
};

const getCached = (cache, key) => {
    const item = cache.get(key);
    if (!item) return null;
    if (item.expiresAt <= Date.now()) {
        cache.delete(key);
        return null;
    }
    cache.delete(key);
    cache.set(key, item);
    return item.value;
};

const setCached = (cache, key, value) => {
    cache.delete(key);
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
};

const clearLookupCaches = () => {
    lookupCache.clear();
    translationCache.clear();
};

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const requestJson = async (url, { method = 'GET', body, headers = {}, timeoutMs = REQUEST_TIMEOUT_MS, retries = 1 } = {}) => {
    let lastFailure;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, {
                method,
                signal: controller.signal,
                headers: { Accept: 'application/json', ...headers },
                ...(body === undefined ? {} : { body: JSON.stringify(body) })
            });
            if (!response.ok) {
                if (TRANSIENT_STATUSES.has(response.status) && attempt < retries) {
                    await wait(200 * (attempt + 1));
                    continue;
                }
                return { ok: false, status: response.status, body: null };
            }
            try {
                return { ok: true, status: response.status, body: await response.json() };
            } catch (error) {
                lastFailure = error;
                if (attempt === retries) throw new UpstreamError('Dictionary provider');
            }
        } catch (error) {
            if (error instanceof UpstreamError) throw error;
            lastFailure = error;
            if (attempt === retries) throw new UpstreamError('Dictionary provider');
        } finally {
            clearTimeout(timer);
        }
        await wait(200 * (attempt + 1));
    }
    throw new UpstreamError(lastFailure?.service || 'Dictionary provider');
};

const normalizeDictionaryWord = word => clean(word, 120)
    .replace(/[“”‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}' -]+$/gu, '')
    .toLowerCase();

const uniqueSenses = senses => {
    const seen = new Set();
    return senses.filter(sense => {
        const key = `${sense.partOfSpeech.toLowerCase()}|${sense.definition.toLowerCase()}`;
        if (!sense.definition || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

const flattenDictionaryEntries = entries => {
    const entryList = Array.isArray(entries) ? entries : entries ? [entries] : [];
    const senses = entryList.flatMap(entry =>
        (entry.meanings || []).flatMap(meaning =>
            (meaning.definitions || []).map(definition => ({
                definition: cleanDictionaryText(definition.definition),
                example: cleanDictionaryText(
                    definition.example || definition.examples?.[0]?.text || ''
                ),
                partOfSpeech: cleanDictionaryText(meaning.partOfSpeech, 80)
            }))
        )
    );
    return {
        entry: entryList[0] || {},
        meanings: uniqueSenses(senses).slice(0, MAX_SENSES),
        phonetic: entryList.map(entry =>
            cleanDictionaryText(entry.phonetic || entry.phonetics?.find(item => item.text)?.text || '', 120)
        ).find(Boolean) || ''
    };
};

const lookupWiktionary = async word => {
    const result = await requestJson(
        `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`
    );
    if (!result.ok || !Array.isArray(result.body?.en)) return null;
    const meanings = uniqueSenses(result.body.en.flatMap(item =>
        (item.definitions || []).map(definition => ({
            definition: cleanDictionaryText(definition.definition),
            example: cleanDictionaryText(
                definition.examples?.[0]?.text || definition.examples?.[0]?.example || ''
            ),
            partOfSpeech: cleanDictionaryText(item.partOfSpeech, 80)
        }))
    )).slice(0, MAX_SENSES);
    return meanings.length ? { meanings } : null;
};

const usableTranslation = (value, source) => {
    const translation = cleanDictionaryText(value);
    if (!translation || translation.toLowerCase() === cleanDictionaryText(source).toLowerCase()) return '';
    if (/^(my memory warning|please contact|no translation found|translation unavailable)\b/i.test(translation)) return '';
    return translation;
};

const translateFreeText = async value => {
    const source = cleanDictionaryText(value, 500);
    if (!source) return '';
    const cacheKey = source.toLowerCase();
    const cached = getCached(translationCache, cacheKey);
    if (cached) return cached;

    const response = await requestJson(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(source)}&langpair=en|vi`,
        { timeoutMs: 5000 }
    );
    if (!response.ok) {
        if (TRANSIENT_STATUSES.has(response.status)) throw new UpstreamError('Translation provider');
        return '';
    }
    if (response.body?.responseStatus === 429 || response.body?.responseStatus >= 500) {
        throw new UpstreamError('Translation provider');
    }
    if (response.body?.responseStatus !== 200) return '';
    const translation = usableTranslation(response.body?.responseData?.translatedText, source);
    if (translation) setCached(translationCache, cacheKey, translation);
    return translation;
};

const translateWithGemini = async tasks => {
    if (!tasks.length || !process.env.GEMINI_API_KEY) return { translations: new Map(), unavailable: false };
    const model = encodeURIComponent(process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite');
    const key = encodeURIComponent(process.env.GEMINI_API_KEY);
    const response = await requestJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
            method: 'POST',
            timeoutMs: 9000,
            body: {
                contents: [{
                    role: 'user',
                    parts: [{
                        text: [
                            'Translate each English IELTS dictionary definition or example into Vietnamese.',
                            'Return JSON only with shape {"translations":[{"id":"...","translation":"..."}]}.',
                            'Keep every translation tied to its exact input id. Do not add definitions, examples, or facts.',
                            'Do not return an English phrase as its Vietnamese translation.',
                            JSON.stringify(tasks)
                        ].join('\n')
                    }]
                }],
                generationConfig: {
                    temperature: 0,
                    responseMimeType: 'application/json',
                    maxOutputTokens: Math.min(3000, tasks.length * 100)
                }
            },
            headers: { 'Content-Type': 'application/json' }
        }
    );
    if (!response.ok) return { translations: new Map(), unavailable: true };

    const raw = response.body?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || '')
        .join('')
        .trim();
    if (!raw) return { translations: new Map(), unavailable: true };

    try {
        const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim());
        const requested = new Map(tasks.map(task => [task.id, task.text]));
        const translations = new Map();
        for (const item of parsed.translations || []) {
            const source = requested.get(item.id);
            if (!source) continue;
            const translation = usableTranslation(item.translation, source);
            if (translation) translations.set(item.id, translation);
        }
        return { translations, unavailable: false };
    } catch {
        return { translations: new Map(), unavailable: true };
    }
};

const mapWithConcurrency = async (items, limit, handler) => {
    const results = new Array(items.length);
    let nextIndex = 0;
    const worker = async () => {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await handler(items[index], index);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
};

const lookupWord = async word => {
    const value = normalizeDictionaryWord(word);
    if (!value) {
        const error = new Error('Word is required');
        error.statusCode = 400;
        throw error;
    }
    const cached = getCached(lookupCache, value);
    if (cached) return structuredClone(cached);

    let dictionaryFailure = false;
    let dictionaryStatus = 0;
    let entry = {};
    let meanings = [];
    try {
        const result = await requestJson(
            `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(value)}`
        );
        dictionaryStatus = result.status;
        if (result.ok) {
            const flattened = flattenDictionaryEntries(result.body);
            entry = flattened.entry;
            meanings = flattened.meanings;
            entry._phonetic = flattened.phonetic;
        }
    } catch {
        dictionaryFailure = true;
    }

    if (!meanings.length) {
        try {
            const fallback = await lookupWiktionary(value);
            if (fallback) meanings = fallback.meanings;
        } catch {
            dictionaryFailure = true;
        }
    }
    if (!meanings.length) {
        if (dictionaryFailure || TRANSIENT_STATUSES.has(dictionaryStatus)) {
            throw new UpstreamError('Dictionary services');
        }
        const notFound = new Error(`No dictionary entry found for “${value}”. Check the spelling or try the base form.`);
        notFound.statusCode = 404;
        throw notFound;
    }

    const translationTasks = meanings.flatMap((sense, index) => [
        { id: `sense-${index}-meaning`, field: 'Translation', senseIndex: index, text: sense.definition },
        ...(sense.example ? [{
            id: `sense-${index}-example`,
            field: 'ExampleTranslation',
            senseIndex: index,
            text: sense.example
        }] : [])
    ]);
    let translationProviderUnavailable = false;
    const freeTranslations = await mapWithConcurrency(translationTasks, 3, async task => {
        if (translationProviderUnavailable) return '';
        try {
            return await translateFreeText(task.text);
        } catch {
            translationProviderUnavailable = true;
            return '';
        }
    });
    const translationsById = new Map(
        translationTasks.map((task, index) => [task.id, freeTranslations[index]])
    );
    const missingTasks = translationTasks
        .filter(task => !translationsById.get(task.id))
        .map(task => ({ id: task.id, text: task.text }));
    let geminiResult = { translations: new Map(), unavailable: false };
    if (missingTasks.length && process.env.GEMINI_API_KEY) {
        try {
            geminiResult = await translateWithGemini(missingTasks);
        } catch {
            geminiResult = { translations: new Map(), unavailable: true };
        }
    }

    const senses = meanings.map((sense, index) => ({
        PartOfSpeech: sense.partOfSpeech,
        Meaning: sense.definition,
        Translation: translationsById.get(`sense-${index}-meaning`)
            || geminiResult.translations.get(`sense-${index}-meaning`)
            || '',
        Example: sense.example || '',
        ExampleTranslation: sense.example
            ? translationsById.get(`sense-${index}-example`)
                || geminiResult.translations.get(`sense-${index}-example`)
                || ''
            : ''
    }));
    const missingMeaningTranslations = senses.some(sense => !sense.Translation);
    const missingExampleTranslations = senses.some(sense => sense.Example && !sense.ExampleTranslation);
    const warnings = [];
    if (missingMeaningTranslations) warnings.push('Some senses are missing Vietnamese translations; review and complete them before publishing.');
    if (missingExampleTranslations) warnings.push('Some example translations are missing; review and complete them before publishing.');
    if (translationProviderUnavailable) warnings.push('The translation service was temporarily unavailable; missing translations were left blank.');
    if (geminiResult.unavailable) warnings.push('The optional translation fallback was unavailable; missing translations were left blank.');

    const firstSense = senses[0];
    const result = {
        Word: cleanDictionaryText(entry.word || value, 120),
        Meaning: firstSense.Meaning,
        Translation: firstSense.Translation,
        PartOfSpeech: firstSense.PartOfSpeech,
        Example: firstSense.Example,
        ExampleTranslation: firstSense.ExampleTranslation,
        Senses: senses,
        Pronunciation: cleanDictionaryText(entry.phonetic || entry._phonetic || '', 120),
        Level: '',
        warnings
    };
    setCached(lookupCache, value, result);
    return structuredClone(result);
};

module.exports = {
    clearLookupCaches,
    cleanDictionaryText,
    flattenDictionaryEntries,
    lookupWiktionary,
    lookupWord,
    mapWithConcurrency,
    normalizeDictionaryWord,
    requestJson
};
