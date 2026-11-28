const test = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('../src/Modules/MistakeNotebook/mistake-notebook.service');

const makeReadingSource = () => ({
    _id: 'sub-1',
    Skill: 'Reading',
    Status: 'Graded',
    Answers: [
        { QuestionOrder: 1, Answer: 'B' },
        { QuestionOrder: 2, Answer: 'A' },
        { QuestionOrder: 3, Answer: 'C' },
        { QuestionOrder: 4, Answer: '' }
    ]
});

const readingAssignment = {
    _id: 'assignment-1',
    Skill: 'Reading',
    Title: 'Reading practice',
    Questions: [
        { Order: 1, Type: 'MultipleChoice', Question: 'First question?', Choices: [{ Key: 'A' }, { Key: 'B' }], CorrectAnswer: 'A', Score: 1 },
        { Order: 2, Type: 'MultipleChoice', Question: 'Second question?', Choices: [{ Key: 'A' }, { Key: 'B' }], CorrectAnswer: 'A', Score: 1 },
        { Order: 3, Type: 'ShortAnswer', Question: 'Third question?', CorrectAnswer: null, Score: 1 },
        { Order: 4, Type: 'ShortAnswer', Question: 'Fourth question?', CorrectAnswer: 'known', Score: 1 },
        { Order: 5, Type: 'ShortAnswer', Question: 'No answer submitted?', CorrectAnswer: 'known', Score: 1 }
    ]
};

const successfulWritingResult = {
    version: 2,
    kind: 'writing',
    estimatedOverallBand: 6,
    criteria: [{}, {}, {}, {}],
    generalFeedback: 'Assessment is complete.',
    actionPlan: ['Review subject agreement.'],
    priorityErrors: [
        { type: 'Grammar', quote: 'He go', explanation: 'Agreement error.', suggestion: 'He goes.' },
        { type: 'Vocabulary', quote: 'quote that is not present', explanation: 'Unverifiable.', suggestion: 'Do not import.' }
    ]
};

test('imports only wrong Reading answers with a known answer key and non-empty response', () => {
    const mistakes = _test.extractAssignmentMistakes(makeReadingSource(), readingAssignment);
    assert.equal(mistakes.length, 1);
    assert.equal(mistakes[0].QuestionOrder, 1);
    assert.equal(mistakes[0].OriginalAnswer, 'B');
    assert.equal(mistakes[0].CorrectAnswer, 'A');
    assert.equal(mistakes[0].SourceKey, 'assignment:sub-1:question:1');
});

test('uses the matched assignment skill when a graded submission did not persist its skill', () => {
    const source = { ...makeReadingSource(), Skill: null };
    const mistakes = _test.extractAssignmentMistakes(source, readingAssignment);
    assert.equal(mistakes.length, 1);
    assert.equal(mistakes[0].Skill, 'Reading');
    assert.equal(_test.getImportCandidates(source, readingAssignment).length, 1);
    assert.deepEqual(
        _test.extractAssignmentMistakes({ ...source, Skill: 'Listening' }, readingAssignment),
        []
    );
});

test('does not import submissions unless fully graded with matching Reading or Listening assignment', () => {
    const source = makeReadingSource();
    assert.deepEqual(_test.extractAssignmentMistakes({ ...source, Status: 'Submitted' }, readingAssignment), []);
    assert.deepEqual(_test.extractAssignmentMistakes(source, { ...readingAssignment, Skill: 'Listening' }), []);
});

test('imports only verifiable stored priority errors from a completed AI evaluation', () => {
    const source = {
        _id: 'ai-1',
        Skill: 'Writing',
        PracticeType: 'Writing',
        Status: 'Graded',
        TaskType: 'task2',
        Prompt: 'Discuss the topic.',
        Answers: [{ QuestionOrder: 1, Answer: 'He go to work.', AIReview: successfulWritingResult }]
    };
    const mistakes = _test.getImportCandidates(source);
    assert.equal(mistakes.length, 1);
    assert.equal(mistakes[0].ErrorQuote, 'He go');
    assert.equal(mistakes[0].OriginalAnswer, 'He go to work.');
    assert.equal(mistakes[0].SourceKey, 'ai:ai-1:answer:1:error:0');
    assert.deepEqual(_test.getImportCandidates({
        ...source,
        Answers: [{ ...source.Answers[0], AIReview: { ...successfulWritingResult, version: 1 } }]
    }), []);
});

test('never imports failed or unreliable Speaking evaluations or unmatched quotes', () => {
    const source = {
        _id: 'ai-2',
        Skill: 'Speaking',
        PracticeType: 'Speaking',
        Status: 'Graded',
        Answers: [{
            QuestionOrder: 1,
            Answer: 'I like books.',
            AIReview: {
                ...successfulWritingResult,
                kind: 'speaking',
                priorityErrors: [{ type: 'Grammar', quote: 'She go', explanation: 'Wrong quote.', suggestion: 'She goes.' }]
            }
        }]
    };
    assert.deepEqual(_test.getImportCandidates(source), []);
    assert.deepEqual(_test.getImportCandidates({
        ...source,
        Answers: [{
            ...source.Answers[0],
            AIReview: { ...source.Answers[0].AIReview, transcriptionStatus: 'uncertain', transcript: '' }
        }]
    }), []);
    assert.deepEqual(_test.getImportCandidates({ ...source, Status: 'Submitted' }), []);
});

test('repeated import extraction generates stable source identities for duplicate prevention', () => {
    const first = _test.extractAssignmentMistakes(makeReadingSource(), readingAssignment);
    const second = _test.extractAssignmentMistakes(makeReadingSource(), readingAssignment);
    assert.deepEqual(first.map(item => item.SourceKey), second.map(item => item.SourceKey));
});

test('mistake review counts only correct recalls and schedules based on the outcome', () => {
    const now = new Date('2026-03-01T12:00:00.000Z');
    const firstCorrect = _test.reviewUpdate({ ReviewCount: 0, CorrectReviewCount: 0, Status: 'New' }, true, now);
    assert.equal(firstCorrect.Status, 'Reviewing');
    assert.equal(firstCorrect.ReviewCount, 1);
    assert.equal(firstCorrect.CorrectReviewCount, 1);
    assert.equal(firstCorrect.NextReviewAt.toISOString(), '2026-03-03T12:00:00.000Z');

    const incorrect = _test.reviewUpdate({ ReviewCount: 1, CorrectReviewCount: 1, Status: 'Reviewing' }, false, now);
    assert.equal(incorrect.ReviewCount, 2);
    assert.equal(incorrect.CorrectReviewCount, 1);
    assert.equal(incorrect.NextReviewAt.toISOString(), '2026-03-02T12:00:00.000Z');
});
