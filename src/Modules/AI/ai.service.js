const getSubmissionModel = require('../LMS/Submission/submission.model');
const { GoogleGenAI } = require('@google/genai');

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 90000;
const MAX_RETRIES = Math.max(0, Math.min(2, Number(process.env.GEMINI_MAX_RETRIES) || 1));
const MAX_OUTPUT_TOKENS = Math.max(3200, Math.min(8000, Number(process.env.GEMINI_MAX_OUTPUT_TOKENS) || 5200));
const MAX_PRIORITY_ERRORS = Math.max(8, Math.min(24, Number(process.env.GEMINI_MAX_ERRORS) || 20));
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const getGeminiClient = () => {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured');
    return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
};

const writingCriteria = taskType => taskType === 'task1'
    ? ['Task Achievement', 'Coherence and Cohesion', 'Lexical Resource', 'Grammatical Range and Accuracy']
    : ['Task Response', 'Coherence and Cohesion', 'Lexical Resource', 'Grammatical Range and Accuracy'];
const speakingCriteria = ['Fluency and Coherence', 'Lexical Resource', 'Grammatical Range and Accuracy', 'Pronunciation'];
const criterionKey = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    .replace('grammaticalrangeaccuracy', 'grammaticalrangeandaccuracy')
    .replace('coherencecohesion', 'coherenceandcohesion')
    .replace('fluencycoherence', 'fluencyandcoherence');
const criterionMatches = (left, right) => {
    const leftKey = criterionKey(left);
    const rightKey = criterionKey(right);
    return leftKey === rightKey || leftKey.startsWith(rightKey) || rightKey.startsWith(leftKey);
};
const normalizeAudioMimeType = value => String(value || '').split(';', 1)[0].trim().toLowerCase();
const supportedAudioMimeTypes = new Set(['audio/webm', 'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/ogg']);
const stripDataUrl = value => String(value || '').replace(/^data:[^,]+,/i, '');

const isValidBand = value => {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) && numeric >= 0 && numeric <= 9;
};

const clampBand = value => {
    if (!isValidBand(value)) return null;
    return Math.round(Number(value) * 2) / 2;
};
const roundOverall = value => Math.round(value * 2) / 2;

const overallFrom = criteria => {
    if (!Array.isArray(criteria) || criteria.length === 0 || criteria.some(item => !isValidBand(item.band))) {
        const error = new Error('AI result does not contain valid criterion bands');
        error.statusCode = 502;
        throw error;
    }
    return roundOverall(criteria.reduce((sum, item) => sum + Number(item.band), 0) / criteria.length);
};

const parseJson = text => {
    const cleaned = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
    try {
        return JSON.parse(cleaned);
    } catch {
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
        throw new Error('Gemini returned invalid JSON');
    }
};

const isRetryableStatus = status => [408, 429, 500, 502, 503, 504].includes(Number(status));
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const requestGemini = async parts => {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured');
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
            const response = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    contents: [{ role: 'user', parts }],
                    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
                })
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                const message = body.error?.message || `Gemini request failed (${response.status})`;
                console.error('[AI] Gemini upstream error', {
                    status: response.status,
                    attempt: attempt + 1,
                    model: MODEL,
                    message: String(message).slice(0, 500)
                });
                if (isRetryableStatus(response.status) && attempt < MAX_RETRIES) {
                    await wait(300 * (attempt + 1));
                    continue;
                }
                const error = new Error(message);
                error.statusCode = response.status === 429 ? 503 : 502;
                throw error;
            }
            const text = body.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('');
            return parseJson(text);
        } catch (error) {
            if (error.name === 'AbortError') {
                console.error('[AI] Gemini upstream timeout', { status: 504, attempt: attempt + 1, model: MODEL, timeoutMs: TIMEOUT_MS });
                if (attempt < MAX_RETRIES) {
                    await wait(300 * (attempt + 1));
                    continue;
                }
                const timeoutError = new Error('Gemini request timed out');
                timeoutError.statusCode = 504;
                throw timeoutError;
            }
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }
};

const normalizeResult = (raw, criteria, kind) => {
    if (!raw || typeof raw !== 'object') {
        const error = new Error('AI returned an empty result');
        error.statusCode = 502;
        throw error;
    }
    const rawCriteria = Array.isArray(raw.criteria) ? raw.criteria : [];
    const criterionName = item => String(item?.name ?? item?.criterion ?? item?.criteriaName ?? '').trim();
    const criterionBand = item => item?.band ?? item?.score ?? item?.bandScore;
    const rawErrors = Array.isArray(raw.priorityErrors)
        ? raw.priorityErrors
        : (Array.isArray(raw.corrections) ? raw.corrections : []);
    const normalizedErrors = rawErrors.slice(0, MAX_PRIORITY_ERRORS).map((item) => {
        if (typeof item === 'string') {
            return {
                type: 'Writing issue',
                quote: '',
                location: '',
                explanation: item.trim(),
                suggestion: ''
            };
        }
        const error = item && typeof item === 'object' ? item : {};
        return {
            type: String(error.type ?? error.category ?? error.criterion ?? 'Writing issue').trim() || 'Writing issue',
            quote: String(error.quote ?? error.original ?? error.evidence ?? '').trim(),
            location: String(error.location ?? error.position ?? '').trim(),
            explanation: String(error.explanation ?? error.error ?? error.description ?? error.message ?? error.text ?? '').trim(),
            suggestion: String(error.suggestion ?? error.correction ?? error.improvement ?? '').trim()
        };
    }).filter(item => item.explanation || item.quote || item.suggestion);
    const normalizedCriteria = criteria.map(name => {
        const item = rawCriteria.find(candidate => criterionMatches(criterionName(candidate), name));
        const band = clampBand(criterionBand(item));
        if (!item || band === null) {
            const error = new Error(`AI result is missing a valid band for ${name}`);
            error.statusCode = 502;
            throw error;
        }
        return {
            name,
            band,
            strengths: Array.isArray(item.strengths) ? item.strengths.slice(0, 8) : [],
            weaknesses: Array.isArray(item.weaknesses) ? item.weaknesses.slice(0, 8) : [],
            evidence: Array.isArray(item.evidence) ? item.evidence.slice(0, 8) : [],
            improvements: Array.isArray(item.improvements) ? item.improvements.slice(0, 8) : []
        };
    });
    return {
        kind,
        estimatedOverallBand: overallFrom(normalizedCriteria),
        criteria: normalizedCriteria,
        strengths: Array.isArray(raw.strengths) ? raw.strengths.slice(0, 10) : [],
        weaknesses: Array.isArray(raw.weaknesses) ? raw.weaknesses.slice(0, 10) : [],
        priorityErrors: normalizedErrors,
        actionPlan: Array.isArray(raw.actionPlan) ? raw.actionPlan.slice(0, 10) : [],
        generalFeedback: typeof raw.generalFeedback === 'string' ? raw.generalFeedback : (typeof raw.feedback === 'string' ? raw.feedback : ''),
        transcript: typeof raw.transcript === 'string' ? raw.transcript : '',
        limitation: typeof raw.limitation === 'string' ? raw.limitation : '',
        disclaimer: 'AI-estimated IELTS band, not an official IELTS result.'
    };
};

const writingPrompt = (taskType, prompt, answer) => `You are an IELTS examiner assistant. Evaluate the student's ${taskType === 'task1' ? 'Academic Writing Task 1' : 'Writing Task 2'} response only against the official-style criteria. Return a complete but concise JSON result. Do not invent quotations or errors. Always return all four criteria, a score, concise evidence, and up to ${MAX_PRIORITY_ERRORS} highest-impact errors (not every minor typo). Use this shape: {"criteria":[{"name":"...","band":6.0,"strengths":[],"weaknesses":[],"evidence":[],"improvements":[]}],"strengths":[],"weaknesses":[],"priorityErrors":[{"type":"Grammar/Lexical/Task","quote":"exact student words","location":"sentence or paragraph","explanation":"what is wrong and why","suggestion":"corrected wording"}],"actionPlan":[],"generalFeedback":""}. Use exact criteria names: ${writingCriteria(taskType).join(', ')}. Return numeric IELTS bands in half-band increments; never use 0 as a placeholder. If a criterion cannot be assessed, explain why instead of inventing a band. Evidence and quotes must come only from the student's response. Keep each error concise so the complete result is returned before timeout. Every priorityErrors item must be an object, not a string. Task prompt: ${prompt}\nStudent response:\n${answer}`;

const streamingWritingPrompt = (taskType, prompt, answer) => `Evaluate this IELTS ${taskType === 'task1' ? 'Academic Writing Task 1' : 'Writing Task 2'} response. Stream newline-delimited JSON objects, one complete object per line, with no markdown or extra text. Emit four criterion_score events first, then feedback, then up to ${MAX_PRIORITY_ERRORS} highest-impact correction events, then a complete result event. Do not omit errors merely because the essay is long; prioritize grammar, vocabulary, task response/achievement and cohesion errors that affect the band. Keep each correction concise. Event shapes: {"event":"criterion_score","data":{"name":"...","band":6.0,"strengths":[],"weaknesses":[],"evidence":[],"improvements":[]}}, {"event":"feedback","data":{"text":"..."}}, {"event":"correction","data":{"type":"Grammar/Lexical/Task","quote":"exact student words","location":"sentence or paragraph","explanation":"what is wrong and why","suggestion":"corrected wording"}}, {"event":"result","data":{"criteria":[],"strengths":[],"weaknesses":[],"priorityErrors":[],"actionPlan":[],"generalFeedback":""}}. Use exact criteria names: ${writingCriteria(taskType).join(', ')}. Never invent evidence; quote only the student's response. Bands use half-band increments. Task prompt: ${prompt}\nStudent response:\n${answer}`;

const speakingPrompt = (part, question) => `You are an IELTS Speaking examiner assistant. Evaluate the attached audio for Speaking Part ${part}. First produce an accurate transcript, then assess the response. Return JSON only with shape {"transcript":"","criteria":[{"name":"...","band":6.0,"strengths":[],"weaknesses":[],"evidence":[],"improvements":[]}],"strengths":[],"weaknesses":[],"priorityErrors":[],"actionPlan":[],"generalFeedback":"","limitation":""}. Return exactly all four criteria with numeric IELTS bands in half-band increments; never use 0 as a placeholder for missing data. Exact criteria: ${speakingCriteria.join(', ')}. Assess Pronunciation only from the audio signal; if audio quality prevents reliable assessment, say so in limitation and do not claim certainty. Question: ${question}`;

const streamingSpeakingPrompt = (part, question) => `Evaluate the attached IELTS Speaking Part ${part} audio. Return newline-delimited JSON objects only, one complete object per line, no markdown. Emit exactly four concise criterion_score events, at most one feedback event, at most one correction event, and a final result event. Keep transcript under 120 words and all arrays short. Use exact criteria: ${speakingCriteria.join(', ')}. The result must include transcript, criteria, strengths, weaknesses, priorityErrors, actionPlan, generalFeedback and limitation. Assess Pronunciation only from audio; if unreliable, state the limitation. Question: ${question}`;

const validateText = (value, label, max) => {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} cannot be empty`);
    if (value.length > max) throw new Error(`${label} is too long`);
    return value.trim();
};

const makeWritingParts = ({ taskType, prompt, answer, image, streaming = false }) => {
    const cleanPrompt = validateText(prompt, 'Task prompt', 10000);
    const cleanAnswer = validateText(answer, 'Writing response', 30000);
    const parts = [{ text: streaming ? streamingWritingPrompt(taskType, cleanPrompt, cleanAnswer) : writingPrompt(taskType, cleanPrompt, cleanAnswer) }];
    if (image?.data) {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType) || image.data.length > 7_000_000) {
            throw new Error('Task 1 image must be PNG, JPEG or WebP and smaller than 5 MB');
        }
        parts.push({ inlineData: { mimeType: image.mimeType, data: stripDataUrl(image.data) } });
    }
    return { parts, cleanPrompt, cleanAnswer };
};

const makeSpeakingParts = ({ part, question, audioBase64, audioMimeType, streaming = false }) => {
    if (!['1', '2', '3'].includes(String(part))) throw new Error('Speaking part must be 1, 2 or 3');
    const cleanQuestion = validateText(question, 'Speaking question', 5000);
    if (typeof audioBase64 !== 'string' || !audioBase64) throw new Error('Audio is required');
    const normalizedAudioMimeType = normalizeAudioMimeType(audioMimeType);
    if (!supportedAudioMimeTypes.has(normalizedAudioMimeType) || audioBase64.length > 10_000_000) {
        throw new Error('Unsupported or oversized audio file');
    }
    return {
        parts: [
            { text: streaming ? streamingSpeakingPrompt(part, cleanQuestion) : speakingPrompt(part, cleanQuestion) },
            { inlineData: { mimeType: normalizedAudioMimeType === 'audio/x-wav' ? 'audio/wav' : normalizedAudioMimeType, data: stripDataUrl(audioBase64) } }
        ],
        cleanQuestion,
        audioMimeType: normalizedAudioMimeType === 'audio/x-wav' ? 'audio/wav' : normalizedAudioMimeType
    };
};

const extractJsonObjects = text => {
    const values = [];
    let start = -1;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (quoted) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === '"') quoted = false;
            continue;
        }
        if (character === '"') { quoted = true; continue; }
        if (character === '{') {
            if (depth === 0) start = index;
            depth += 1;
        } else if (character === '}' && depth > 0) {
            depth -= 1;
            if (depth === 0 && start >= 0) {
                try { values.push(JSON.parse(text.slice(start, index + 1))); } catch { /* incomplete/invalid object */ }
                start = -1;
            }
        }
    }
    return values;
};

const streamGemini = async ({ parts, criteria, kind, signal, onEvent }) => {
    const client = getGeminiClient();
    const stream = await client.models.generateContentStream({
        model: MODEL,
        contents: [{ role: 'user', parts }],
        config: { temperature: 0.2, maxOutputTokens: MAX_OUTPUT_TOKENS, responseMimeType: 'text/plain' }
    });
    let lineBuffer = '';
    let resultPayload = null;
    let rawText = '';
    const emitted = new Set();
    const streamedCriteria = [];
    const streamedFeedback = [];
    const streamedCorrections = [];
    const acceptEvent = event => {
        if (!event) return;
        const eventName = event.event || event.type;
        let data = event.data;
        if (eventName === 'criterion_score' && !data) {
            data = { name: event.criterion, band: event.score, strengths: [], weaknesses: [], evidence: [], improvements: [] };
        }
        if (eventName === 'criterion_score' && data && !data.name && data.criterion) {
            data = { ...data, name: data.criterion, band: data.band ?? data.score };
        }
        if (eventName === 'feedback' && !data) {
            data = { text: [...(event.strengths || []), ...(event.weaknesses || [])].join(' ') };
        }
        if (eventName === 'correction' && !data) {
            data = { type: 'speaking', quote: event.original || '', explanation: event.correction || '', suggestion: event.correction || '' };
        }
        if (eventName === 'result' && (!data || !Array.isArray(data.criteria))) {
            data = { criteria: streamedCriteria, strengths: [], weaknesses: [], priorityErrors: streamedCorrections, actionPlan: [], generalFeedback: streamedFeedback.join(' '), transcript: '', limitation: 'The audio stream did not include a transcript.' };
        }
        if (!['criterion_score', 'feedback', 'correction', 'result'].includes(eventName) || !data) return;
        if (eventName === 'result') { resultPayload = data; return; }
        const key = `${eventName}:${JSON.stringify(data)}`;
        if (emitted.has(key)) return;
        emitted.add(key);
        if (eventName === 'criterion_score') {
            const expectedName = criteria.find(name => criterionMatches(name, data.name));
            if (!expectedName) return;
            const normalizedData = { ...data, name: expectedName };
            const existingIndex = streamedCriteria.findIndex(item => item.name === expectedName);
            if (existingIndex >= 0) streamedCriteria[existingIndex] = normalizedData;
            else streamedCriteria.push(normalizedData);
        }
        if (eventName === 'feedback' && data.text) streamedFeedback.push(data.text);
        if (eventName === 'correction') streamedCorrections.push(data);
        onEvent(eventName, data);
    };
    for await (const chunk of stream) {
        if (signal?.aborted) throw Object.assign(new Error('Client disconnected'), { statusCode: 499 });
        const delta = chunk.text || '';
        if (!delta) continue;
        rawText += delta;
        lineBuffer += delta;
        const lines = lineBuffer.split(/\r?\n/);
        lineBuffer = lines.pop() || '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            let event;
            try { event = JSON.parse(trimmed); } catch { continue; }
            acceptEvent(event);
        }
    }
    const extractedEvents = extractJsonObjects(rawText);
    extractedEvents.forEach(acceptEvent);
    if (!resultPayload) {
        if (streamedCriteria.length > 0) {
            resultPayload = {
                criteria: streamedCriteria,
                strengths: [],
                weaknesses: [],
                priorityErrors: streamedCorrections,
                actionPlan: [],
                generalFeedback: streamedFeedback.join(' '),
                transcript: '',
                limitation: 'The AI stream ended before a complete transcript/result was returned.'
            };
        } else {
            const parsed = parseJson(rawText.trim());
            resultPayload = parsed.result || parsed;
        }
    }
    const criterionName = item => criterionKey(item?.name ?? item?.criterion ?? item?.criteriaName);
    const resultCriteria = Array.isArray(resultPayload.criteria) ? resultPayload.criteria : [];
    const mergedCriteria = criteria.map(name => {
        const streamed = streamedCriteria.find(item => criterionMatches(criterionName(item), name));
        const final = resultCriteria.find(item => criterionMatches(criterionName(item), name));
        // Criterion events are emitted as soon as they are available. Preserve them
        // when Gemini's final summary omits or partially rewrites one criterion.
        return { ...(final || {}), ...(streamed || {}) };
    });
    try {
        return normalizeResult({ ...resultPayload, criteria: mergedCriteria }, criteria, kind);
    } catch (error) {
        if (error.statusCode !== 502 || !String(error.message).includes('missing a valid band')) throw error;
        console.warn('[AI] Structured stream was incomplete; requesting one bounded repair result', { model: MODEL, kind });
        const repairPrompt = `${parts[0].text}\n\nThe streamed response was incomplete. Return ONE complete JSON object only, with no markdown and no event lines. It must contain exactly these criteria with numeric half-band scores: ${criteria.join(', ')}. Include up to ${MAX_PRIORITY_ERRORS} concise priorityErrors objects with type, quote, location, explanation and suggestion. Do not use zero as a placeholder and do not omit any criterion.`;
        const repaired = await requestGemini([{ text: repairPrompt }, ...parts.slice(1)]);
        return normalizeResult(repaired, criteria, kind);
    }
};

const savePractice = async ({ userId, practiceType, taskType, prompt, answer, result, audioMimeType = '' }) => {
    const Submission = getSubmissionModel();
    return Submission.create({
        UserID: userId, Skill: practiceType, PracticeType: practiceType, TaskType: taskType,
        Prompt: prompt, AudioMimeType: audioMimeType, StartTime: new Date(), SubmitTime: new Date(),
        Duration: 0, Status: 'Graded', Answers: [{ QuestionOrder: 1, Answer: answer, AIReview: result }],
        BandScore: result.estimatedOverallBand, TotalScore: result.estimatedOverallBand
    });
};

const evaluateWriting = async ({ userId, taskType, prompt, answer, image }) => {
    if (!['task1', 'task2'].includes(taskType)) throw new Error('taskType must be task1 or task2');
    const { parts, cleanPrompt, cleanAnswer } = makeWritingParts({ taskType, prompt, answer, image });
    const result = normalizeResult(await requestGemini(parts), writingCriteria(taskType), 'writing');
    return savePractice({ userId, practiceType: 'Writing', taskType, prompt: cleanPrompt, answer: cleanAnswer, result });
};

const evaluateSpeaking = async ({ userId, part, question, audioBase64, audioMimeType }) => {
    const { parts, cleanQuestion, audioMimeType: normalizedAudioMimeType } = makeSpeakingParts({ part, question, audioBase64, audioMimeType });
    const result = normalizeResult(await requestGemini([
        ...parts
    ]), speakingCriteria, 'speaking');
    return savePractice({ userId, practiceType: 'Speaking', taskType: `part${part}`, prompt: cleanQuestion, answer: result.transcript, result, audioMimeType: normalizedAudioMimeType });
};

const streamWriting = async ({ userId, taskType, prompt, answer, image, signal, onEvent }) => {
    if (!['task1', 'task2'].includes(taskType)) throw new Error('taskType must be task1 or task2');
    const { parts, cleanPrompt, cleanAnswer } = makeWritingParts({ taskType, prompt, answer, image, streaming: true });
    const result = await streamGemini({ parts, criteria: writingCriteria(taskType), kind: 'writing', signal, onEvent });
    return savePractice({ userId, practiceType: 'Writing', taskType, prompt: cleanPrompt, answer: cleanAnswer, result });
};

const streamSpeaking = async ({ userId, part, question, audioBase64, audioMimeType, signal, onEvent }) => {
    const { parts, cleanQuestion, audioMimeType: normalizedAudioMimeType } = makeSpeakingParts({ part, question, audioBase64, audioMimeType, streaming: true });
    const result = await streamGemini({ parts, criteria: speakingCriteria, kind: 'speaking', signal, onEvent });
    return savePractice({ userId, practiceType: 'Speaking', taskType: `part${part}`, prompt: cleanQuestion, answer: result.transcript, result, audioMimeType: normalizedAudioMimeType });
};

const getPracticeHistory = async (userId, skill) => {
    const Submission = getSubmissionModel();
    const filter = { UserID: userId, PracticeType: { $in: skill ? [skill] : ['Writing', 'Speaking'] } };
    return Submission.find(filter).sort({ createdAt: -1 }).limit(20).lean();
};

module.exports = {
    evaluateWriting,
    evaluateSpeaking,
    streamWriting,
    streamSpeaking,
    getPracticeHistory,
    _test: { clampBand, isValidBand, overallFrom, normalizeResult, parseJson, isRetryableStatus, writingCriteria, speakingCriteria, normalizeAudioMimeType, stripDataUrl }
};
