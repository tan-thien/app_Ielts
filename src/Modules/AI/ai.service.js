const getSubmissionModel = require('../LMS/Submission/submission.model');

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const configuredTimeout = Number(process.env.GEMINI_TIMEOUT_MS) || 150000;
const TIMEOUT_MS = Math.max(30000, Math.min(180000, configuredTimeout));
const MAX_RETRIES = Math.max(0, Math.min(1, Number(process.env.GEMINI_MAX_RETRIES) || 0));
const MAX_OUTPUT_TOKENS = Math.max(2400, Math.min(5000, Number(process.env.GEMINI_MAX_OUTPUT_TOKENS) || 3800));
const MAX_PRIORITY_ERRORS = Math.max(4, Math.min(10, Number(process.env.GEMINI_MAX_ERRORS) || 8));
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

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
const textList = (value, limit = 4) => Array.isArray(value)
    ? value.filter(item => typeof item === 'string' && item.trim()).slice(0, limit).map(item => item.trim().slice(0, 500))
    : [];

const requestGemini = async (parts, options = {}) => {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured');
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
        const abortFromCaller = () => controller.abort();
        options.signal?.addEventListener('abort', abortFromCaller, { once: true });
        try {
            const response = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    contents: [{ role: 'user', parts }],
                    generationConfig: {
                        temperature: 0.2,
                        maxOutputTokens: MAX_OUTPUT_TOKENS,
                        responseMimeType: 'application/json'
                    }
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
                if (options.signal?.aborted) {
                    throw Object.assign(new Error('AI evaluation was cancelled'), { statusCode: 499 });
                }
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
            options.signal?.removeEventListener('abort', abortFromCaller);
        }
    }
};

const requestGeminiStream = async (parts, signal, onText) => {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured');
    if (signal?.aborted) {
        throw Object.assign(new Error('AI evaluation was cancelled'), { statusCode: 499 });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const abortFromCaller = () => controller.abort();
    signal?.addEventListener('abort', abortFromCaller, { once: true });

    try {
        const streamUrl = GEMINI_URL.replace(':generateContent', ':streamGenerateContent');
        const response = await fetch(`${streamUrl}?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}&alt=sse`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                contents: [{ role: 'user', parts }],
                generationConfig: {
                    temperature: 0.2,
                    maxOutputTokens: MAX_OUTPUT_TOKENS,
                    responseMimeType: 'text/plain'
                }
            })
        });
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            const message = body.error?.message || `Gemini request failed (${response.status})`;
            console.error('[AI] Gemini streaming upstream error', {
                status: response.status,
                model: MODEL,
                message: String(message).slice(0, 500)
            });
            const error = new Error(message);
            error.statusCode = response.status === 429 ? 503 : 502;
            throw error;
        }
        if (!response.body) {
            const error = new Error('Gemini did not return a response stream');
            error.statusCode = 502;
            throw error;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let receivedText = false;
        const dispatch = block => {
            const data = block.split(/\r?\n/)
                .filter(line => line.startsWith('data:'))
                .map(line => line.slice(5).trim())
                .join('\n');
            if (!data || data === '[DONE]') return;
            let payload;
            try {
                payload = JSON.parse(data);
            } catch {
                return;
            }
            const text = payload.candidates?.[0]?.content?.parts
                ?.map(part => part.text || '')
                .join('');
            if (text) {
                receivedText = true;
                onText(text);
            }
        };

        while (true) {
            if (signal?.aborted) throw Object.assign(new Error('Client disconnected'), { statusCode: 499 });
            const { value, done } = await reader.read();
            buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
            const blocks = buffer.split(/\r?\n\r?\n/);
            buffer = blocks.pop() || '';
            blocks.forEach(dispatch);
            if (done) break;
        }
        if (buffer.trim()) dispatch(buffer);
        if (!receivedText) {
            const error = new Error('Gemini returned an empty streaming response');
            error.statusCode = 502;
            throw error;
        }
    } catch (error) {
        if (controller.signal.aborted && !signal?.aborted) {
            console.error('[AI] Gemini streaming timeout', { status: 504, model: MODEL, timeoutMs: TIMEOUT_MS });
            throw Object.assign(new Error('AI evaluation timed out. Please try again.'), { statusCode: 504 });
        }
        if (signal?.aborted) {
            throw Object.assign(new Error('AI evaluation was cancelled'), { statusCode: 499 });
        }
        throw error;
    } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abortFromCaller);
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
                explanation: item.trim().slice(0, 600),
                suggestion: ''
            };
        }
        const error = item && typeof item === 'object' ? item : {};
        return {
            type: (String(error.type ?? error.category ?? error.criterion ?? 'Writing issue').trim() || 'Writing issue').slice(0, 80),
            quote: String(error.quote ?? error.original ?? error.evidence ?? '').trim().slice(0, 500),
            location: String(error.location ?? error.position ?? '').trim().slice(0, 160),
            explanation: String(error.explanation ?? error.error ?? error.description ?? error.message ?? error.text ?? '').trim().slice(0, 600),
            suggestion: String(error.suggestion ?? error.correction ?? error.improvement ?? '').trim().slice(0, 600)
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
            strengths: textList(item.strengths, 3),
            weaknesses: textList(item.weaknesses, 3),
            evidence: textList(item.evidence, 3),
            improvements: textList(item.improvements, 3)
        };
    });
    return {
        kind,
        estimatedOverallBand: overallFrom(normalizedCriteria),
        criteria: normalizedCriteria,
        strengths: textList(raw.strengths, 5),
        weaknesses: textList(raw.weaknesses, 5),
        priorityErrors: normalizedErrors,
        actionPlan: textList(raw.actionPlan, 4),
        generalFeedback: typeof raw.generalFeedback === 'string'
            ? raw.generalFeedback.slice(0, 1500)
            : (typeof raw.feedback === 'string' ? raw.feedback.slice(0, 1500) : ''),
        bandRationale: typeof raw.bandRationale === 'string' ? raw.bandRationale.slice(0, 800) : '',
        correctedResponse: typeof raw.correctedResponse === 'string' ? raw.correctedResponse.slice(0, 12000) : '',
        transcript: typeof raw.transcript === 'string' ? raw.transcript.slice(0, 5000) : '',
        limitation: typeof raw.limitation === 'string' ? raw.limitation.slice(0, 800) : '',
        disclaimer: 'AI-estimated IELTS band, not an official IELTS result.'
    };
};

const writingPrompt = (taskType, prompt, answer) => `Act as a careful IELTS Writing examiner. Assess this ${taskType === 'task1' ? 'Academic Task 1' : 'Task 2'} against IELTS public band descriptors. Give a useful, specific report, not generic praise. Write feedback explanations, bandRationale, actionPlan and generalFeedback in Vietnamese; keep quotes and corrected English in English. Consider whether the response develops enough detail for the task (normally at least 150 words for Task 1 and 250 for Task 2), but do not apply a mechanical word-count penalty. Return one JSON object only.
Exact criteria: ${writingCriteria(taskType).join(', ')}. Use half-band scores from 0 to 9; estimate consistently and explain the main band-limiting reasons in bandRationale. Never promise an official score.
For each criterion provide 1-2 concise strengths, weaknesses, evidence quotes from the response, and actionable improvements. Do not invent quotes, errors, chart data or task requirements. Identify the 6 most important real language/logic issues maximum; each correction must quote exact wording and show a natural correction plus a brief explanation. Prioritize repeated grammar patterns (articles, subject-verb agreement, tense, sentence structure), unnatural collocations, vocabulary precision, paragraph logic and task coverage. Do not list every typo.
Return: {"criteria":[{"name":"exact criterion","band":6.0,"strengths":[],"weaknesses":[],"evidence":[],"improvements":[]}],"strengths":[],"weaknesses":[],"priorityErrors":[{"type":"Grammar/Lexical/Coherence/Task","quote":"exact words","location":"sentence or paragraph","explanation":"brief reason","suggestion":"natural correction"}],"actionPlan":["three ranked next steps"],"generalFeedback":"2-3 sentences: task coverage, organization, language control and what most limits the band","bandRationale":"briefly explain the overall estimate and the main gap to the next half band","correctedResponse":"A polished version preserving the student's own position and ideas. Correct language and improve development without inventing evidence. Keep it close to the original length, maximum 350 words. For Task 1 use only visible/given information; if the chart cannot be read, leave this field empty and explain the limitation."}.
Evidence and corrected wording must not misrepresent the answer. Keep every field concise; return no markdown. Task: ${prompt}\nStudent response:\n${answer}`;

const streamingWritingPrompt = (taskType, prompt, answer) => `Evaluate this IELTS ${taskType === 'task1' ? 'Academic Task 1' : 'Task 2'} response carefully using public IELTS band descriptors. Write explanations, feedback and actionPlan in Vietnamese; keep evidence quotes, corrections and correctedResponse in English. Consider whether the response develops enough detail for the task (normally at least 150 words for Task 1 and 250 for Task 2), but do not apply a mechanical word-count penalty. Stream newline-delimited JSON objects only, no markdown. Emit four criterion_score events, one concise feedback event, up to 6 high-impact correction events, then one complete result event. Exact criteria: ${writingCriteria(taskType).join(', ')}. Bands use half-band increments. Each criterion event needs band plus concise strengths, weaknesses, evidence and improvements. Quote exact student wording only; do not invent errors or task/chart facts. Prioritize repeated article, subject-verb, tense, sentence-structure and collocation issues; no minor-typo dump. Corrections: {"event":"correction","data":{"type":"Grammar/Lexical/Coherence/Task","quote":"exact words","location":"sentence or paragraph","explanation":"brief Vietnamese reason","suggestion":"natural English correction"}}. Final result must follow this schema: {"event":"result","data":{"criteria":[],"strengths":[],"weaknesses":[],"priorityErrors":[],"actionPlan":["three ranked steps"],"generalFeedback":"2-3 sentences in Vietnamese","bandRationale":"why this estimate and biggest gap to next half band in Vietnamese","correctedResponse":"polished version preserving ideas, close to original length, max 350 words"}}. For Task 1 do not invent unreadable chart data; leave correctedResponse empty if necessary. Keep total output concise.
Task: ${prompt}\nStudent response:\n${answer}`;

const speakingPrompt = (part, question) => `Act as a careful IELTS Speaking examiner. Assess the attached Speaking Part ${part} audio against public IELTS band descriptors. Write feedback, explanations, rationale and actionPlan in Vietnamese; transcript, evidence quotes and corrected English examples remain in English. Return one JSON object only. First transcribe the audible response accurately, including meaningful hesitations only where useful. Assess exact criteria: ${speakingCriteria.join(', ')}. Use half-band scores; never infer pronunciation from transcript. For Pronunciation, use audio only and state limitations if recording quality prevents a confident judgment. Don't invent transcript quotes or phoneme errors.
Return: {"transcript":"full clear transcript, max 250 words","criteria":[{"name":"exact criterion","band":6.0,"strengths":[],"weaknesses":[],"evidence":[],"improvements":[]}],"strengths":[],"weaknesses":[],"priorityErrors":[{"type":"Grammar/Lexical/Fluency/Pronunciation","quote":"exact transcript words or identifiable audio issue","location":"brief context","explanation":"brief reason","suggestion":"natural alternative or exercise"}],"actionPlan":["three ranked, practical drills"],"generalFeedback":"2-3 specific sentences","bandRationale":"explain the estimate and main gap to the next half band","limitation":"state any audio/assessment limitation or empty string"}.
Give 1-2 concise notes per criterion and no more than 4 high-impact corrections. Distinguish language errors from pronunciation observations. Keep output concise. Question: ${question}`;

const streamingSpeakingPrompt = (part, question) => `Assess the attached IELTS Speaking Part ${part} audio. Write feedback, explanations, rationale and actionPlan in Vietnamese; transcript, evidence quotes and corrected English examples stay in English. Stream newline-delimited JSON objects only, without markdown. Emit four criterion_score events, one concise feedback event, up to 4 evidence-based correction events, then a complete result event. Exact criteria: ${speakingCriteria.join(', ')}. Use half-band scores. Transcribe the audible response faithfully (max 250 words). Assess pronunciation from audio only; if unclear, state limitation and don't guess. Do not invent transcript quotes or pronunciation errors. Criterion events need concise strengths, weaknesses, evidence and improvements. Final result: {"event":"result","data":{"transcript":"","criteria":[],"strengths":[],"weaknesses":[],"priorityErrors":[],"actionPlan":["three practical drills"],"generalFeedback":"2-3 specific Vietnamese sentences","bandRationale":"why this estimate and biggest gap to next half band in Vietnamese","limitation":""}}. Keep all feedback concise. Question: ${question}`;

const validateText = (value, label, max) => {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} cannot be empty`);
    if (value.length > max) throw new Error(`${label} is too long`);
    return value.trim();
};

const makeWritingParts = ({ taskType, prompt, answer, image, streaming = false }) => {
    const cleanPrompt = validateText(prompt, 'Task prompt', 10000);
    const cleanAnswer = validateText(answer, 'Writing response', 12000);
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
    const consumeText = delta => {
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
    };
    await requestGeminiStream(parts, signal, consumeText);
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
        const repairPrompt = `${parts[0].text}\n\nThe stream ended before all criteria received valid half-band scores. Return one complete concise JSON object only, with exactly these criteria: ${criteria.join(', ')}. Include bandRationale, criterion evidence/improvements, up to ${MAX_PRIORITY_ERRORS} concise corrections, three action steps, and the required final response/transcript fields. Do not invent evidence.`;
        const repaired = await requestGemini([{ text: repairPrompt }, ...parts.slice(1)], { signal });
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
    _test: {
        clampBand,
        isValidBand,
        overallFrom,
        normalizeResult,
        parseJson,
        isRetryableStatus,
        writingCriteria,
        speakingCriteria,
        normalizeAudioMimeType,
        stripDataUrl,
        requestGeminiStream,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        maxPriorityErrors: MAX_PRIORITY_ERRORS
    }
};
