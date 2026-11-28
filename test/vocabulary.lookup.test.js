const test = require('node:test');
const assert = require('node:assert/strict');
const lookup = require('../src/Modules/Vocabulary/vocabulary.lookup');

const response = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
});

const setup = (context, fetcher) => {
    const originalFetch = global.fetch;
    const originalKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    lookup.clearLookupCaches();
    global.fetch = fetcher;
    context.after(() => {
        global.fetch = originalFetch;
        if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = originalKey;
        lookup.clearLookupCaches();
    });
};

const dictionaryEntry = {
    word: 'milestone',
    phonetics: [{ text: '/ˈmaɪl.stoʊn/' }],
    meanings: [
        {
            partOfSpeech: 'noun',
            definitions: [
                { definition: 'A numbered marker on a road.' },
                { definition: 'An important event in a project.' }
            ]
        },
        {
            partOfSpeech: 'verb',
            definitions: [
                { definition: 'To place milestones along a road.' },
                { definition: 'To plan a project in major steps.' }
            ]
        }
    ]
};

test('lookup keeps every dictionary sense and never invents examples', async context => {
    setup(context, async url => {
        if (String(url).includes('dictionaryapi.dev')) return response([dictionaryEntry]);
        if (String(url).includes('mymemory.translated.net')) {
            const source = new URL(url).searchParams.get('q');
            return response({ responseStatus: 200, responseData: { translatedText: `VI ${source}` } });
        }
        throw new Error('Unexpected upstream request');
    });

    const result = await lookup.lookupWord('milestone');
    assert.equal(result.Senses.length, 4);
    assert.deepEqual(result.Senses.map(sense => sense.PartOfSpeech), ['noun', 'noun', 'verb', 'verb']);
    assert.equal(new Set(result.Senses.map(sense => sense.Translation)).size, 4);
    assert.ok(result.Senses.every(sense => sense.Example === '' && sense.ExampleTranslation === ''));
    assert.equal(result.Example, '');
    assert.equal(result.Pronunciation, '/ˈmaɪl.stoʊn/');
});

test('lookup uses Wiktionary after a network failure and cleans its HTML', async context => {
    let wiktionaryCalls = 0;
    setup(context, async url => {
        if (String(url).includes('dictionaryapi.dev')) throw new Error('simulated network failure');
        if (String(url).includes('wiktionary.org')) {
            wiktionaryCalls += 1;
            return response({
                en: [{
                    partOfSpeech: 'Noun',
                    definitions: [{
                        definition: 'A stone <a href="/wiki/milepost">milepost</a> &amp; road marker.'
                    }]
                }]
            });
        }
        if (String(url).includes('mymemory.translated.net')) {
            return response({ responseStatus: 200, responseData: { translatedText: 'cột mốc đường' } });
        }
        throw new Error('Unexpected upstream request');
    });

    const result = await lookup.lookupWord('milestone');
    assert.equal(wiktionaryCalls, 1);
    assert.equal(result.Senses[0].Meaning, 'A stone milepost & road marker.');
    assert.equal(result.Senses[0].Example, '');
});

test('a missing sense translation stays blank instead of reusing the word translation', async context => {
    setup(context, async url => {
        if (String(url).includes('dictionaryapi.dev')) {
            return response([{
                word: 'testword',
                meanings: [{
                    partOfSpeech: 'noun',
                    definitions: [
                        { definition: 'First definition.' },
                        { definition: 'Second definition.' }
                    ]
                }]
            }]);
        }
        if (String(url).includes('mymemory.translated.net')) {
            const source = new URL(url).searchParams.get('q');
            return response({
                responseStatus: source.startsWith('First') ? 200 : 404,
                responseData: { translatedText: source.startsWith('First') ? 'bản dịch thứ nhất' : '' }
            });
        }
        throw new Error('Unexpected upstream request');
    });

    const result = await lookup.lookupWord('testword');
    assert.equal(result.Senses[0].Translation, 'bản dịch thứ nhất');
    assert.equal(result.Senses[1].Translation, '');
    assert.ok(result.warnings.some(warning => warning.includes('missing Vietnamese translations')));
});

test('Gemini translation fallback accepts only returned sense identifiers', async context => {
    setup(context, async url => {
        if (String(url).includes('dictionaryapi.dev')) {
            return response([{
                word: 'testword',
                meanings: [{
                    partOfSpeech: 'noun',
                    definitions: [{ definition: 'First definition.' }, { definition: 'Second definition.' }]
                }]
            }]);
        }
        if (String(url).includes('mymemory.translated.net')) {
            return response({ responseStatus: 404, responseData: { translatedText: '' } });
        }
        if (String(url).includes('generativelanguage.googleapis.com')) {
            return response({
                candidates: [{
                    content: {
                        parts: [{ text: JSON.stringify({ translations: [{ id: 'sense-0-meaning', translation: 'nghĩa thứ nhất' }] }) }]
                    }
                }]
            });
        }
        throw new Error('Unexpected upstream request');
    });
    process.env.GEMINI_API_KEY = 'test-key';

    const result = await lookup.lookupWord('testword');
    assert.equal(result.Senses[0].Translation, 'nghĩa thứ nhất');
    assert.equal(result.Senses[1].Translation, '');
    assert.ok(result.warnings.some(warning => warning.includes('missing Vietnamese translations')));
});

test('lookup distinguishes upstream failure from a missing dictionary entry', async context => {
    setup(context, async url => {
        if (String(url).includes('dictionaryapi.dev')) throw new Error('simulated network failure');
        if (String(url).includes('wiktionary.org')) return response({ status: 404 }, 404);
        throw new Error('Unexpected upstream request');
    });

    await assert.rejects(lookup.lookupWord('unknownword'), error => error.statusCode === 503);
});

test('transient dictionary errors receive one bounded retry', async context => {
    let attempts = 0;
    setup(context, async () => {
        attempts += 1;
        return attempts === 1 ? response({}, 503) : response({ ok: true });
    });

    const result = await lookup.requestJson('https://dictionary.example.test', { timeoutMs: 100, retries: 1 });
    assert.equal(attempts, 2);
    assert.equal(result.ok, true);
});

test('parallel work respects its configured concurrency limit', async () => {
    let active = 0;
    let maxActive = 0;
    await lookup.mapWithConcurrency([1, 2, 3, 4, 5], 2, async value => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, 2));
        active -= 1;
        return value;
    });
    assert.equal(maxActive, 2);
});
