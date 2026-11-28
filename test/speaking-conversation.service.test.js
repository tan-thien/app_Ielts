const test = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('../src/Modules/AI/speaking-conversation.service');

const SESSION_ID = '507f1f77bcf86cd799439011';
const USER_ID = 'user-123';

const createRepository = () => {
    let session = null;
    let result = null;
    let messages = [];
    let sequence = 0;
    return {
        async createSession(values) {
            session = { _id: SESSION_ID, ...values };
            return { ...session };
        },
        async findOwnedSession(id, userId) {
            return id === SESSION_ID && session?.userId === userId ? { ...session } : null;
        },
        async listSessions(userId) {
            return session?.userId === userId ? [{ ...session }] : [];
        },
        async listMessages(id, limit) {
            return id === SESSION_ID ? messages.slice(-limit).map(message => ({ ...message })) : [];
        },
        async addMessage(message) {
            const saved = { _id: `message-${++sequence}`, ...message, createdAt: new Date().toISOString() };
            messages.push(saved);
            return { ...saved };
        },
        async updateSession(id, userId, values) {
            if (id !== SESSION_ID || session?.userId !== userId) return null;
            session = { ...session, ...values };
            return { ...session };
        },
        async claimTurn(id, userId, maxUserTurns) {
            if (
                id !== SESSION_ID
                || session?.userId !== userId
                || session.status !== 'active'
                || session.turnInProgress
                || session.userTurnCount >= maxUserTurns
            ) return null;
            session = { ...session, turnInProgress: true };
            return { ...session };
        },
        async claimResult(id, userId, minUserTurns) {
            if (
                id !== SESSION_ID
                || session?.userId !== userId
                || session.status !== 'active'
                || session.turnInProgress
                || session.userTurnCount < minUserTurns
            ) return null;
            session = { ...session, turnInProgress: true };
            return { ...session };
        },
        async findResult(id, userId) {
            return id === SESSION_ID && session?.userId === userId ? result : null;
        },
        async saveResult(id, userId, values) {
            if (id !== SESSION_ID || session?.userId !== userId) return null;
            result = { sessionId: id, userId, ...values };
            return { ...result };
        },
        inspect() {
            return { session, result, messages };
        }
    };
};

const makeModel = handler => async (prompt, contents, options) => handler({ prompt, contents, options });

test('requires a valid part and a bounded topic before requesting the model', async () => {
    let calls = 0;
    const service = _test.createService({
        repo: createRepository(),
        generate: makeModel(() => {
            calls += 1;
            return { message: 'What do you enjoy about your hometown?' };
        })
    });

    await assert.rejects(service.createSession(USER_ID, { mode: 'free', part: '4' }), { statusCode: 400 });
    await assert.rejects(service.createSession(USER_ID, { mode: 'topic', part: '1', topic: 'x'.repeat(81) }), { statusCode: 400 });
    assert.equal(calls, 0);
});

test('creates an authenticated context session with an assistant opening prompt', async () => {
    const repo = createRepository();
    let received;
    const service = _test.createService({
        repo,
        generate: makeModel(input => {
            received = input;
            return { message: 'What do you enjoy doing at weekends?' };
        })
    });

    const response = await service.createSession(USER_ID, { mode: 'topic', part: '1', topic: 'Free time' });
    assert.equal(response.session.userId, USER_ID);
    assert.equal(response.session.topic, 'Free time');
    assert.equal(response.messages[0].role, 'assistant');
    assert.match(received.prompt, /Part 1/);
    assert.equal(JSON.parse(received.contents[0].parts[0].text).topic, 'Free time');
    await assert.rejects(service.getSession('someone-else', SESSION_ID), { statusCode: 404 });
});

test('limits Gemini history and persists only complete user/assistant turns', async () => {
    const repo = createRepository();
    const service = _test.createService({
        repo,
        generate: makeModel(({ contents }) => {
            if (contents[0].parts[0].text.includes('speaking_practice_configuration')) {
                return { message: 'What do you like about your area?' };
            }
            return { message: 'What makes that place special to you?' };
        })
    });
    const started = await service.createSession(USER_ID, { mode: 'free', part: '1' });
    for (let turn = 0; turn < 7; turn += 1) {
        await service.sendMessage(USER_ID, SESSION_ID, { message: `Answer number ${turn + 1}` });
    }

    let turnContents;
    const boundedService = _test.createService({
        repo,
        generate: makeModel(input => {
            turnContents = input.contents;
            return { message: 'Can you tell me a little more?' };
        })
    });
    const response = await boundedService.sendMessage(USER_ID, SESSION_ID, { message: 'A final answer' });
    assert.equal(turnContents.length, _test.MAX_HISTORY_MESSAGES + 1);
    assert.equal(turnContents.at(-1).parts[0].text, 'A final answer');
    assert.equal(turnContents.at(-1).role, 'user');
    assert.equal(response.messages.length, 2);
    assert.equal(repo.inspect().session.userTurnCount, 8);
    assert.equal(repo.inspect().messages.length, 17);
    assert.ok(started.session._id);
});

test('rejects empty or oversized answers and does not persist failed model turns', async () => {
    const repo = createRepository();
    const service = _test.createService({
        repo,
        generate: makeModel(({ contents }) => contents.length === 1
            ? { message: 'Tell me about your neighbourhood.' }
            : { message: 'What do you like best about it?' })
    });
    await service.createSession(USER_ID, { mode: 'free', part: '1' });
    await assert.rejects(service.sendMessage(USER_ID, SESSION_ID, { message: '  ' }), { statusCode: 400 });
    await assert.rejects(service.sendMessage(USER_ID, SESSION_ID, { message: 'a'.repeat(3001) }), { statusCode: 400 });

    const failingService = _test.createService({
        repo,
        generate: makeModel(() => ({ message: '' }))
    });
    await assert.rejects(failingService.sendMessage(USER_ID, SESSION_ID, { message: 'I live near the coast.' }), { statusCode: 502 });
    assert.equal(repo.inspect().messages.length, 1);
    assert.equal(repo.inspect().session.turnInProgress, false);
});

test('allows only one concurrent answer generation per session', async () => {
    const repo = createRepository();
    let releaseModel;
    const modelGate = new Promise(resolve => { releaseModel = resolve; });
    const service = _test.createService({
        repo,
        generate: makeModel(async ({ contents }) => {
            if (contents.length === 1) return { message: 'What do you enjoy about your city?' };
            await modelGate;
            return { message: 'What else do you like about it?' };
        })
    });
    await service.createSession(USER_ID, { mode: 'free', part: '1' });
    const first = service.sendMessage(USER_ID, SESSION_ID, { message: 'I enjoy the parks.' });
    await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(
        service.sendMessage(USER_ID, SESSION_ID, { message: 'I also like the cafes.' }),
        { statusCode: 409 }
    );
    releaseModel();
    await first;
    assert.equal(repo.inspect().session.userTurnCount, 1);
    assert.equal(repo.inspect().session.turnInProgress, false);
});

test('allows only one result generation while completing a session', async () => {
    const repo = createRepository();
    let releaseResult;
    const resultGate = new Promise(resolve => { releaseResult = resolve; });
    const resultPayload = {
        summary: 'You shared a clear personal example.',
        strengths: ['You explained a personal preference.'],
        focusAreas: ['Add another supporting detail.'],
        evidence: [{ quote: 'I enjoy gardening', observation: 'A clear statement of your interest.' }]
    };
    const service = _test.createService({
        repo,
        generate: makeModel(async ({ prompt }) => {
            if (prompt.includes('exact short substring')) {
                await resultGate;
                return resultPayload;
            }
            return { message: 'What else do you enjoy about it?' };
        })
    });
    await service.createSession(USER_ID, { mode: 'free', part: '1' });
    await service.sendMessage(USER_ID, SESSION_ID, { message: 'I enjoy gardening at home.' });
    await service.sendMessage(USER_ID, SESSION_ID, { message: 'It helps me relax.' });

    const firstFinish = service.endSession(USER_ID, SESSION_ID);
    await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(service.endSession(USER_ID, SESSION_ID), { statusCode: 409 });
    releaseResult();
    const finished = await firstFinish;
    assert.equal(finished.session.status, 'completed');
    assert.equal(repo.inspect().session.turnInProgress, false);
});

test('requires enough real answers and rejects result evidence not present in the learner text', async () => {
    const repo = createRepository();
    let resultResponse = {
        summary: 'You shared a clear personal preference.',
        strengths: ['You answered the question directly.'],
        focusAreas: ['Add a concrete supporting example.'],
        evidence: [{ quote: 'I like quiet parks', observation: 'This directly states your preference.' }]
    };
    const service = _test.createService({
        repo,
        generate: makeModel(({ prompt, contents }) => {
            if (prompt.includes('exact short substring')) return resultResponse;
            return { message: 'What do you like doing after work?' };
        })
    });
    await service.createSession(USER_ID, { mode: 'free', part: '1' });
    await service.sendMessage(USER_ID, SESSION_ID, { message: 'I like quiet parks near my home.' });
    await assert.rejects(service.endSession(USER_ID, SESSION_ID), { statusCode: 422 });
    await service.sendMessage(USER_ID, SESSION_ID, { message: 'I walk there with my sister.' });

    resultResponse = { ...resultResponse, evidence: [{ quote: 'I am fluent and confident', observation: 'An unsupported claim.' }] };
    await assert.rejects(service.endSession(USER_ID, SESSION_ID), { statusCode: 502 });
    assert.equal(repo.inspect().session.status, 'active');
    assert.equal(repo.inspect().result, null);

    resultResponse = {
        ...resultResponse,
        evidence: [{ quote: 'I like quiet parks', observation: 'This directly states your preference.' }]
    };
    const finished = await service.endSession(USER_ID, SESSION_ID);
    assert.equal(finished.session.status, 'completed');
    assert.match(finished.result.disclaimer, /không phải điểm IELTS chính thức/);
    assert.match(finished.result.disclaimer, /không đánh giá phát âm/);
    assert.equal(Object.hasOwn(finished.result, 'estimatedBand'), false);
});

test('session access is scoped to the authenticated user and completed sessions reject new turns', async () => {
    const repo = createRepository();
    const service = _test.createService({
        repo,
        generate: makeModel(({ prompt }) => prompt.includes('exact short substring')
            ? {
                summary: 'Two answers provided useful detail.',
                strengths: ['You included personal details.'],
                focusAreas: ['Develop one idea further.'],
                evidence: [{ quote: 'I enjoy cycling', observation: 'A direct personal example.' }]
            }
            : { message: 'Why do you enjoy it?' })
    });
    await service.createSession(USER_ID, { mode: 'free', part: '1' });
    await assert.rejects(service.getSession('another-user', SESSION_ID), { statusCode: 404 });
    await service.sendMessage(USER_ID, SESSION_ID, { message: 'I enjoy cycling in the park.' });
    await service.sendMessage(USER_ID, SESSION_ID, { message: 'It helps me relax.' });
    await service.endSession(USER_ID, SESSION_ID);
    await assert.rejects(service.sendMessage(USER_ID, SESSION_ID, { message: 'One more thought.' }), { statusCode: 409 });
});
