const test = require('node:test');
const assert = require('node:assert/strict');

const assignmentModelPath = require.resolve('../src/Modules/LMS/Assignment/Assignment.model');
const lessonModelPath = require.resolve('../src/Modules/LMS/lesson/lesson.model');
const submissionModelPath = require.resolve('../src/Modules/LMS/Submission/submission.model');
const orderServicePath = require.resolve('../src/Modules/LMS/Order/order.service');

require(assignmentModelPath);
require(lessonModelPath);
require(submissionModelPath);
require(orderServicePath);

let assignments = [];
let activeLessons = [];
let assignmentForReview = null;
let submissionForReview = null;
let hasAccess = () => true;
let capturedListFilter;
let capturedReviewFilter;

const assignmentModel = {
    find(filter) {
        capturedListFilter = filter;
        return { sort: async () => assignments };
    },
    findOne: async () => assignmentForReview
};
const lessonModel = {
    find: async () => activeLessons,
    findById: () => ({ select: async () => null })
};
const submissionModel = {
    findOne: async filter => {
        capturedReviewFilter = filter;
        return submissionForReview;
    }
};

const patchModule = (path, replacement) => {
    const moduleRecord = require.cache[path];
    const original = moduleRecord.exports;
    moduleRecord.exports = replacement;
    return () => { moduleRecord.exports = original; };
};

const restore = [
    patchModule(assignmentModelPath, () => assignmentModel),
    patchModule(lessonModelPath, () => lessonModel),
    patchModule(submissionModelPath, () => submissionModel),
    patchModule(orderServicePath, { hasCourseAccess: (...args) => hasAccess(...args) })
];

const {
    getReadingListeningPracticeAssignments,
    getReadingListeningPracticeReview
} = require('../src/Modules/LMS/Assignment/assignment.service');

restore.forEach(restoreModule => restoreModule());

const makeAssignment = (overrides = {}) => ({
    _id: 'assignment-reading',
    Title: 'Reading practice',
    Skill: 'Reading',
    IsOpen: true,
    IsDeleted: false,
    CourseID: 'course-paid',
    Questions: [{
        Order: 1,
        Question: 'What is the main idea?',
        CorrectAnswer: 'A',
        Explanation: 'The first paragraph states the main idea.'
    }],
    ...overrides
});

test('practice listing filters Reading and Listening, enforces paid access and hides answer keys', async () => {
    const reading = makeAssignment();
    const listening = makeAssignment({
        _id: 'assignment-listening',
        Skill: 'Listening',
        CourseID: null,
        LessonID: 'lesson-active'
    });
    const inaccessible = makeAssignment({
        _id: 'assignment-unpaid',
        CourseID: 'course-unpaid'
    });
    assignments = [reading, listening, inaccessible];
    activeLessons = [{ _id: 'lesson-active', CourseID: 'course-paid' }];
    hasAccess = async courseId => courseId === 'course-paid';

    const result = await getReadingListeningPracticeAssignments('learner-id');

    assert.deepEqual(result.map(item => item._id), ['assignment-reading', 'assignment-listening']);
    assert.deepEqual(capturedListFilter.Skill, { $in: ['Reading', 'Listening'] });
    assert.equal(capturedListFilter.IsOpen, true);
    assert.equal(capturedListFilter.IsDeleted, false);
    assert.deepEqual(capturedListFilter['Questions.0'], { $exists: true });
    for (const assignment of result) {
        assert.equal('CorrectAnswer' in assignment.Questions[0], false);
        assert.equal('Explanation' in assignment.Questions[0], false);
    }
});

test('review refuses an active attempt and only returns keys for the owner after submission', async () => {
    assignmentForReview = makeAssignment();
    submissionForReview = {
        _id: 'submission-id',
        AssignmentID: 'assignment-reading',
        UserID: 'learner-id',
        Status: 'Doing',
        Answers: []
    };

    await assert.rejects(
        getReadingListeningPracticeReview('assignment-reading', 'submission-id', 'learner-id'),
        /Submit this attempt/
    );

    submissionForReview = {
        ...submissionForReview,
        Status: 'Graded',
        Answers: [{ QuestionOrder: 1, Answer: 'A', Score: 1 }],
        TotalScore: 1,
        BandScore: 9,
        Duration: 75
    };
    const review = await getReadingListeningPracticeReview(
        'assignment-reading',
        'submission-id',
        'learner-id'
    );

    assert.equal(capturedReviewFilter.UserID, 'learner-id');
    assert.equal(capturedReviewFilter.AssignmentID, 'assignment-reading');
    assert.equal(review.Questions[0].CorrectAnswer, 'A');
    assert.equal(review.Submission.Answers[0].Score, 1);
});

test('review does not disclose answer keys without course access', async () => {
    assignmentForReview = makeAssignment();
    submissionForReview = { Status: 'Graded' };
    hasAccess = async () => false;

    await assert.rejects(
        getReadingListeningPracticeReview('assignment-reading', 'submission-id', 'learner-id'),
        /successful course payment/
    );
});
