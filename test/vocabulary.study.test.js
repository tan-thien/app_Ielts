const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createServer } = require('node:http');
const study = require('../src/Modules/Vocabulary/vocabulary.study.service');

test('flashcard word IDs are validated and deduplicated', () => {
    const first = '64b64c2f4d8c6b7a3d12f001';
    const second = '64b64c2f4d8c6b7a3d12f002';
    assert.deepEqual(study.normalizeWordIds([first, first, second]), [first, second]);
    assert.throws(() => study.normalizeWordIds([first, 'not-an-object-id']), /invalid/);
    assert.throws(() => study.normalizeWordIds('not-an-array'), /array/);
    assert.throws(() => study.normalizeWordIds(Array(201).fill(first)), /at most 200/);
});

test('review scheduling uses spaced intervals, resets failed recalls, and bounds ease', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const firstGood = study.scheduleReview(null, 'good', now);
    assert.equal(firstGood.IntervalDays, 1);
    assert.equal(firstGood.Repetitions, 1);
    assert.equal(firstGood.NextReviewAt.toISOString(), '2026-01-02T00:00:00.000Z');

    const nextGood = study.scheduleReview(firstGood, 'good', now);
    assert.equal(nextGood.IntervalDays, 3);
    const again = study.scheduleReview({ EaseFactor: 1.3, Repetitions: 4, IntervalDays: 12 }, 'again', now);
    assert.equal(again.IntervalDays, 1 / 144);
    assert.equal(again.Repetitions, 0);
    assert.equal(again.EaseFactor, 1.3);
    assert.equal(again.NextReviewAt.toISOString(), '2026-01-01T00:10:00.000Z');
    assert.throws(() => study.scheduleReview(null, 'unknown', now), /Rating must be/);
});

test('pagination clamps invalid and oversized page values', () => {
    assert.deepEqual(study.pagination('0', '200'), { page: 1, limit: 50, skip: 0 });
    assert.deepEqual(study.pagination('3', '10'), { page: 3, limit: 10, skip: 20 });
    assert.deepEqual(study.pagination('-4', '-2'), { page: 1, limit: 1, skip: 0 });
});

test('flashcard and review endpoints reject unauthenticated requests', async () => {
    const app = express();
    app.use('/vocabulary', require('../src/Modules/Vocabulary/vocabulary.routes'));
    const server = createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
        for (const [path, method] of [
            ['/vocabulary/flashcards', 'GET'],
            ['/vocabulary/review', 'GET'],
            ['/vocabulary/review/history', 'GET'],
            ['/vocabulary/review/64b64c2f4d8c6b7a3d12f001', 'POST']
        ]) {
            const response = await fetch(`http://127.0.0.1:${port}${path}`, { method });
            assert.equal(response.status, 401, `${method} ${path} should require a JWT`);
        }
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
});

test('study controller derives owner from JWT claims rather than request body', async () => {
    const service = require('../src/Modules/Vocabulary/vocabulary.study.service');
    const controller = require('../src/Modules/Vocabulary/vocabulary.study.controller');
    const original = service.listSets;
    let receivedOwner;
    service.listSets = async ownerId => { receivedOwner = ownerId; return []; };
    try {
        const response = { json: body => body };
        await controller.listSets({
            user: { userId: 'jwt-owner', role: 'user' },
            query: {},
            body: { UserID: 'forged-owner' }
        }, response);
        assert.equal(receivedOwner, 'jwt-owner');
    } finally {
        service.listSets = original;
    }
});
