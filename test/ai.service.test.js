const test = require('node:test');
const assert = require('node:assert/strict');

const { _test } = require('../src/Modules/AI/ai.service');

const writingTask2 = {
    criteria: [
        { name: 'Task Response', band: 6, strengths: ['Answers both views'] },
        { name: 'Coherence and Cohesion', band: 6 },
        { name: 'Lexical Resource', band: 5.5 },
        { name: 'Grammatical Range and Accuracy', band: 6 }
    ],
    strengths: ['Clear position'],
    generalFeedback: 'The response is understandable.'
};

test('normalizes a complete Writing Task 2 result without converting valid scores to zero', () => {
    const result = _test.normalizeResult({
        ...writingTask2,
        bandRationale: 'Ngữ pháp giới hạn band hiện tại.',
        correctedResponse: 'A corrected essay.'
    }, _test.writingCriteria('task2'), 'writing');
    assert.deepEqual(result.criteria.map(item => item.band), [6, 6, 5.5, 6]);
    assert.equal(result.estimatedOverallBand, 6);
    assert.deepEqual(result.strengths, ['Clear position']);
    assert.equal(result.bandRationale, 'Ngữ pháp giới hạn band hiện tại.');
    assert.equal(result.correctedResponse, 'A corrected essay.');
});

test('accepts Gemini Speaking criterion/score aliases', () => {
    const raw = {
        criteria: _test.speakingCriteria.map((criterion, index) => ({ criterion, score: 6 + index * 0.5 })),
        limitation: 'Pronunciation was assessed from the audio signal.'
    };
    const result = _test.normalizeResult(raw, _test.speakingCriteria, 'speaking');
    assert.deepEqual(result.criteria.map(item => item.band), [6, 6.5, 7, 7.5]);
    assert.equal(result.estimatedOverallBand, 7);
});

test('parses fenced JSON and ignores surrounding text', () => {
    assert.deepEqual(_test.parseJson('```json\n{"ok":true}\n```'), { ok: true });
    assert.deepEqual(_test.parseJson('Here is the result:\n{"ok":true}\nThanks'), { ok: true });
});

test('rejects a missing or malformed band instead of defaulting to zero', () => {
    const incomplete = { ...writingTask2, criteria: writingTask2.criteria.map(item => ({ ...item })) };
    delete incomplete.criteria[2].band;
    assert.throws(() => _test.normalizeResult(incomplete, _test.writingCriteria('task2'), 'writing'), /missing a valid band/);

    const malformed = { ...writingTask2, criteria: writingTask2.criteria.map(item => ({ ...item })) };
    malformed.criteria[2].band = 'not-a-number';
    assert.throws(() => _test.normalizeResult(malformed, _test.writingCriteria('task2'), 'writing'), /missing a valid band/);
});

test('requires the Task 1 criterion name rather than accepting Task 2 data', () => {
    assert.throws(() => _test.normalizeResult(writingTask2, _test.writingCriteria('task1'), 'writing'), /Task Achievement/);
});

test('computes overall from validated criteria, not an untrusted overall field', () => {
    const raw = { ...writingTask2, estimatedOverallBand: 9 };
    const result = _test.normalizeResult(raw, _test.writingCriteria('task2'), 'writing');
    assert.equal(result.estimatedOverallBand, 6);
});

test('normalizes string and alias correction items so the UI does not render blank errors', () => {
    const raw = {
        ...writingTask2,
        priorityErrors: ['The response repeats basic vocabulary.', { category: 'Grammar', original: 'He go', error: 'Subject-verb agreement error', correction: 'He goes' }]
    };
    const result = _test.normalizeResult(raw, _test.writingCriteria('task2'), 'writing');
    assert.equal(result.priorityErrors[0].explanation, 'The response repeats basic vocabulary.');
    assert.equal(result.priorityErrors[1].type, 'Grammar');
    assert.equal(result.priorityErrors[1].quote, 'He go');
    assert.equal(result.priorityErrors[1].suggestion, 'He goes');
});

test('identifies only transient upstream failures as retryable', () => {
    assert.equal(_test.isRetryableStatus(429), true);
    assert.equal(_test.isRetryableStatus(503), true);
    assert.equal(_test.isRetryableStatus(400), false);
    assert.equal(_test.isRetryableStatus(401), false);
});

test('normalizes MediaRecorder MIME parameters for Gemini audio input', () => {
    assert.equal(_test.normalizeAudioMimeType('audio/webm;codecs=opus'), 'audio/webm');
    assert.equal(_test.normalizeAudioMimeType(' AUDIO/WAV ; codecs=1 '), 'audio/wav');
    assert.equal(_test.stripDataUrl('data:audio/webm;codecs=opus;base64,QUJD'), 'QUJD');
    assert.equal(_test.stripDataUrl('data:image/png;base64,QUJD'), 'QUJD');
});

test('streams Gemini text from server-sent events and uses the streaming endpoint', async () => {
    const oldFetch = global.fetch;
    const oldApiKey = process.env.GEMINI_API_KEY;
    let requestUrl = '';
    const chunk = `data: ${JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"event":"result"}\n' }] } }]
    })}\n\n`;
    global.fetch = async (url) => {
        requestUrl = String(url);
        return new Response(chunk, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    process.env.GEMINI_API_KEY = 'test-key';
    try {
        let streamed = '';
        await _test.requestGeminiStream([], undefined, text => { streamed += text; });
        assert.match(requestUrl, /:streamGenerateContent\?key=test-key&alt=sse/);
        assert.equal(streamed, '{"event":"result"}\n');
    } finally {
        global.fetch = oldFetch;
        if (oldApiKey === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = oldApiKey;
    }
});

test('cancels Gemini streaming promptly when the browser disconnects', async () => {
    const oldFetch = global.fetch;
    const oldApiKey = process.env.GEMINI_API_KEY;
    global.fetch = async (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
        }, { once: true });
    });
    process.env.GEMINI_API_KEY = 'test-key';
    const controller = new AbortController();
    try {
        const request = _test.requestGeminiStream([], controller.signal, () => {});
        setImmediate(() => controller.abort());
        await assert.rejects(request, error => error.statusCode === 499);
    } finally {
        global.fetch = oldFetch;
        if (oldApiKey === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = oldApiKey;
    }
});

test('keeps AI feedback output bounded for latency and response size', () => {
    assert.ok(_test.maxOutputTokens >= 2400 && _test.maxOutputTokens <= 5000);
    assert.ok(_test.maxPriorityErrors >= 4 && _test.maxPriorityErrors <= 10);
});
