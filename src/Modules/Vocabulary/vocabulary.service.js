const { GoogleGenAI } = require('@google/genai');
const getTopicModel = require('./vocabulary_topic.model');
const getWordModel = require('./vocabulary_word.model');
const getSavedModel = require('./saved_vocabulary.model');

const clean = (value, max = 1000) => String(value ?? '').trim().slice(0, max);
const id = value => String(value || '');
const assertText = (value, field) => {
    const result = clean(value);
    if (!result) throw new Error(`${field} is required`);
    return result;
};
const normalizeTopic = body => ({
    Name: assertText(body.Name, 'Topic name'),
    Description: clean(body.Description, 500),
    IsActive: body.IsActive !== false
});
const normalizeWord = body => ({
    TopicID: assertText(body.TopicID, 'Topic'),
    Word: assertText(body.Word, 'Word'),
    Meaning: assertText(body.Meaning, 'Meaning'),
    Translation: assertText(body.Translation, 'Translation'),
    PartOfSpeech: clean(body.PartOfSpeech, 80),
    Example: assertText(body.Example, 'Example sentence'),
    ExampleTranslation: clean(body.ExampleTranslation, 1000),
    Senses: Array.isArray(body.Senses) ? body.Senses.slice(0, 20).map(sense => ({
        PartOfSpeech: clean(sense.PartOfSpeech, 80),
        Meaning: clean(sense.Meaning, 1000),
        Translation: clean(sense.Translation, 1000),
        Example: clean(sense.Example, 1000),
        ExampleTranslation: clean(sense.ExampleTranslation, 1000)
    })) : undefined,
    Pronunciation: clean(body.Pronunciation, 120),
    Level: clean(body.Level, 40),
    IsActive: body.IsActive !== false
});

const listTopics = async ({ includeInactive = false } = {}) => {
    const Topic = getTopicModel();
    const filter = { IsDeleted: false };
    if (!includeInactive) filter.IsActive = true;
    return Topic.find(filter).sort({ Name: 1 }).lean();
};

const listWords = async ({ topicId, search = '', includeInactive = false } = {}) => {
    const Word = getWordModel();
    const filter = { IsDeleted: false };
    if (topicId) filter.TopicID = topicId;
    if (!includeInactive) filter.IsActive = true;
    const value = clean(search, 100);
    if (value) filter.$or = [
        { Word: new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
        { Translation: new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
    ];
    return Word.find(filter).populate('TopicID', 'Name').sort({ Word: 1 }).lean();
};

const createTopic = async (body, userId) => {
    const Topic = getTopicModel();
    return Topic.create({ ...normalizeTopic(body), CreatedBy: userId });
};
const updateTopic = async (topicId, body) => {
    const Topic = getTopicModel();
    const topic = await Topic.findOneAndUpdate({ _id: topicId, IsDeleted: false }, normalizeTopic(body), { new: true, runValidators: true });
    if (!topic) throw new Error('Topic not found');
    return topic;
};
const deleteTopic = async topicId => {
    const Topic = getTopicModel();
    const Word = getWordModel();
    const topic = await Topic.findOneAndUpdate({ _id: topicId, IsDeleted: false }, { IsDeleted: true }, { new: true });
    if (!topic) throw new Error('Topic not found');
    await Word.updateMany({ TopicID: topicId }, { IsDeleted: true });
    return topic;
};
const createWord = async body => {
    const Topic = getTopicModel();
    const Word = getWordModel();
    const data = normalizeWord(body);
    if (!await Topic.exists({ _id: data.TopicID, IsDeleted: false })) throw new Error('Topic not found');
    return Word.create(data);
};
const updateWord = async (wordId, body) => {
    const Topic = getTopicModel();
    const Word = getWordModel();
    const data = normalizeWord(body);
    if (!await Topic.exists({ _id: data.TopicID, IsDeleted: false })) throw new Error('Topic not found');
    const word = await Word.findOneAndUpdate({ _id: wordId, IsDeleted: false }, data, { new: true, runValidators: true });
    if (!word) throw new Error('Vocabulary word not found');
    return word;
};
const deleteWord = async wordId => {
    const Word = getWordModel();
    const word = await Word.findOneAndUpdate({ _id: wordId, IsDeleted: false }, { IsDeleted: true }, { new: true });
    if (!word) throw new Error('Vocabulary word not found');
    return word;
};

const listSaved = async userId => {
    const Saved = getSavedModel();
    const items = await Saved.find({ UserID: userId }).populate({ path: 'WordID', populate: { path: 'TopicID', select: 'Name' } }).sort({ createdAt: -1 }).lean();
    return items.filter(item => item.WordID && item.WordID.IsDeleted !== true && item.WordID.IsActive !== false);
};
const saveWord = async (userId, wordId, note = '') => {
    const Word = getWordModel();
    const Saved = getSavedModel();
    if (!await Word.exists({ _id: wordId, IsDeleted: false, IsActive: true })) throw new Error('Vocabulary word not found');
    return Saved.findOneAndUpdate({ UserID: userId, WordID: wordId }, { $set: { Note: clean(note) } }, { upsert: true, new: true, setDefaultsOnInsert: true }).populate({ path: 'WordID', populate: { path: 'TopicID', select: 'Name' } });
};
const saveExternalWord = async (userId, word) => {
    const Topic = getTopicModel();
    const Word = getWordModel();
    const topic = await Topic.findOneAndUpdate(
        { Name: 'External dictionary', IsDeleted: false },
        { $setOnInsert: { Name: 'External dictionary', Description: 'Words saved from the external dictionary.', CreatedBy: userId, IsActive: true, IsDeleted: false } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const data = await lookupWord(word);
    const savedWord = await Word.findOneAndUpdate(
        { TopicID: topic._id, Word: data.Word, IsDeleted: false },
        { ...data, TopicID: topic._id, IsDeleted: false },
        { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    );
    return saveWord(userId, savedWord._id);
};
const updateSaved = async (userId, wordId, body) => {
    const Saved = getSavedModel();
    const saved = await Saved.findOneAndUpdate({ UserID: userId, WordID: wordId }, { Note: clean(body.Note), IsLearned: body.IsLearned === true }, { new: true }).populate({ path: 'WordID', populate: { path: 'TopicID', select: 'Name' } });
    if (!saved) throw new Error('Saved word not found');
    return saved;
};
const removeSaved = async (userId, wordId) => {
    const Saved = getSavedModel();
    const result = await Saved.findOneAndDelete({ UserID: userId, WordID: wordId });
    if (!result) throw new Error('Saved word not found');
    return result;
};

const translateFreeText = async value => {
    const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(clean(value, 500))}&langpair=en|vi`);
    if (!response.ok) return '';
    const body = await response.json();
    return clean(body?.responseData?.translatedText, 1000);
};

const translateText = async ({ word, context = '' }) => {
    const freeWord = await translateFreeText(word).catch(() => '');
    const freeExample = context ? await translateFreeText(context).catch(() => '') : '';
    if (freeWord) {
        return { translation: freeWord, meaning: context || word, partOfSpeech: '', example: context || word, exampleTranslation: freeExample };
    }
    if (!process.env.GEMINI_API_KEY) throw new Error('Translation service is not configured');
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
    const response = await ai.models.generateContent({
        model,
        contents: `Translate this English IELTS vocabulary item to Vietnamese. Return JSON only with keys translation, meaning, partOfSpeech, example, exampleTranslation. Do not invent context. Word: ${clean(word, 120)}. Context: ${clean(context, 500)}`,
        config: { temperature: 0.1, responseMimeType: 'application/json', maxOutputTokens: 500 }
    });
    const raw = response.text || '';
    const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim());
    if (!parsed.translation || !parsed.meaning || !parsed.example) throw new Error('Translation service returned incomplete data');
    return parsed;
};

const fetchJson = async (url, timeoutMs = 8000) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
            if (response.ok) return { ok: true, status: response.status, body: await response.json() };
            if (![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === 1) {
                return { ok: false, status: response.status, body: null };
            }
        } catch (error) {
            if (attempt === 1) throw error;
        } finally {
            clearTimeout(timer);
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
};

const normalizeDictionaryWord = word => assertText(word, 'Word')
    .replace(/[“”‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}' -]+$/gu, '')
    .toLowerCase();

const flattenDictionaryApiEntry = entry => ({
    entry,
    meanings: (entry?.meanings || [])
        .flatMap(item => (item.definitions || []).slice(0, 4).map(definition => ({
            ...definition,
            partOfSpeech: item.partOfSpeech || ''
        })))
        .slice(0, 12)
});

const lookupWiktionary = async value => {
    const result = await fetchJson(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(value)}`);
    if (!result.ok || !result.body?.en) return null;
    const meanings = result.body.en
        .flatMap(item => (item.definitions || []).slice(0, 4).map(definition => ({
            definition: definition.definition,
            example: definition.examples?.[0]?.text || '',
            partOfSpeech: item.partOfSpeech || ''
        })))
        .filter(item => item.definition)
        .slice(0, 12);
    return meanings.length ? { entry: { word: value }, meanings } : null;
};

const lookupWord = async word => {
    const value = normalizeDictionaryWord(word);
    if (!value) throw new Error('Word is required');

    let dictionaryResult;
    try {
        dictionaryResult = await fetchJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(value)}`);
    } catch (error) {
        if (error.name !== 'AbortError') {
            const serviceError = new Error('Dictionary service is temporarily unavailable');
            serviceError.statusCode = 503;
            throw serviceError;
        }
        dictionaryResult = { ok: false, status: 408 };
    }

    let entry;
    let meanings = [];
    if (dictionaryResult.ok) {
        const flattened = flattenDictionaryApiEntry(dictionaryResult.body?.[0]);
        entry = flattened.entry;
        meanings = flattened.meanings;
    }
    if (!meanings.length) {
        try {
            const fallback = await lookupWiktionary(value);
            entry = fallback?.entry || entry;
            meanings = fallback?.meanings || [];
        } catch (error) {
            if (error.name !== 'AbortError') {
                const serviceError = new Error('Dictionary service is temporarily unavailable');
                serviceError.statusCode = 503;
                throw serviceError;
            }
        }
    }
    if (!meanings.length) {
        if ([408, 429, 500, 502, 503, 504].includes(dictionaryResult.status)) {
            const serviceError = new Error('Dictionary service is temporarily unavailable. Please try again.');
            serviceError.statusCode = 503;
            throw serviceError;
        }
        const notFound = new Error(`No dictionary entry found for “${value}”. Check the spelling or try the base form.`);
        notFound.statusCode = 404;
        throw notFound;
    }
    const wordTranslation = await translateFreeText(value).catch(() => '');
    const senses = [];
    for (const definition of meanings) {
        let definitionTranslation = await translateFreeText(definition.definition).catch(() => '');
        let exampleTranslation = definition.example ? await translateFreeText(definition.example).catch(() => '') : '';
        if (!definitionTranslation && process.env.GEMINI_API_KEY) {
            const fallback = await translateText({ word: value, context: definition.definition });
            definitionTranslation = fallback.translation;
            exampleTranslation ||= fallback.exampleTranslation;
        }
        senses.push({
            PartOfSpeech: definition.partOfSpeech,
            Meaning: definition.definition,
            Translation: definitionTranslation || wordTranslation,
            Example: definition.example || '',
            ExampleTranslation: exampleTranslation
        });
    }
    const firstSense = senses[0];
    return {
        Word: entry.word || value,
        Meaning: firstSense.Meaning,
        Translation: firstSense.Translation || wordTranslation,
        PartOfSpeech: firstSense.PartOfSpeech,
        Example: firstSense.Example || `Example: ${value}`,
        ExampleTranslation: firstSense.ExampleTranslation,
        Senses: senses,
        Pronunciation: entry.phonetic || entry.phonetics?.find(item => item.text)?.text || '',
        Level: ''
    };
};

const translate = async ({ word, context = '' }) => {
    const dictionary = await lookupWord(word);
    return {
        translation: dictionary.Translation,
        meaning: dictionary.Meaning,
        partOfSpeech: dictionary.PartOfSpeech,
        example: dictionary.Example,
        exampleTranslation: dictionary.ExampleTranslation,
        senses: dictionary.Senses,
        context
    };
};

const bulkImport = async (topicId, values) => {
    const Topic = getTopicModel();
    const Word = getWordModel();
    if (!await Topic.exists({ _id: topicId, IsDeleted: false })) throw new Error('Topic not found');
    const words = [...new Set(String(values || '').split(/[\n,;]+/).map(value => value.trim().toLowerCase()).filter(Boolean))];
    if (!words.length) throw new Error('Enter at least one word');
    if (words.length > 50) throw new Error('Import is limited to 50 words at a time');
    const result = { imported: [], failed: [] };
    for (const word of words) {
        try {
            const data = await lookupWord(word);
            const saved = await Word.findOneAndUpdate(
                { TopicID: topicId, Word: data.Word, IsDeleted: false },
                { ...data, TopicID: topicId, IsDeleted: false },
                { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
            );
            result.imported.push(saved);
        } catch (error) {
            result.failed.push({ word, message: error.message || 'Lookup failed' });
        }
    }
    return result;
};

module.exports = { listTopics, listWords, createTopic, updateTopic, deleteTopic, createWord, updateWord, deleteWord, listSaved, saveWord, saveExternalWord, updateSaved, removeSaved, translate, lookupWord, bulkImport };
