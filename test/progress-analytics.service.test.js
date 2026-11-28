const test = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('../src/Modules/ProgressAnalytics/progress-analytics.service');
const analyticsService = require('../src/Modules/ProgressAnalytics/progress-analytics.service');
const analyticsController = require('../src/Modules/ProgressAnalytics/progress-analytics.controller');

test('AI bands require a completed saved AI Writing or Speaking attempt', () => {
    const savedWriting = {
        Status: 'Graded',
        PracticeType: 'Writing',
        AIRequestID: 'attempt-1',
        Answers: [{ AIReview: { estimatedOverallBand: 6.5 } }]
    };
    assert.equal(_test.getEstimatedBand(savedWriting), 6.5);
    assert.equal(_test.getEstimatedBand({ ...savedWriting, PracticeType: 'Reading' }), null);
    assert.equal(_test.getEstimatedBand({ ...savedWriting, AIRequestID: null }), null);
    assert.equal(_test.getEstimatedBand({ ...savedWriting, Status: 'Submitted' }), null);
    assert.equal(_test.getEstimatedBand({
        ...savedWriting,
        Answers: [{ AIReview: { estimatedOverallBand: 6.3 } }]
    }), null);
    assert.equal(_test.getEstimatedBand({
        ...savedWriting,
        Answers: [{ AIReview: { estimatedOverallBand: null } }]
    }), null);
});

test('objective assignment percentage excludes unverified, incomplete, and subjective work', () => {
    const assignment = {
        Questions: [
            { Type: 'MultipleChoice', Score: 2 },
            { Type: 'FillBlank', Score: 3 }
        ]
    };
    const submission = {
        Status: 'Graded',
        TotalScore: 4,
        Answers: [{ Score: 2 }, { Score: 2 }]
    };
    assert.equal(_test.getObjectiveAssignmentPercent(submission, assignment), 80);
    assert.equal(_test.getObjectiveAssignmentPercent({ ...submission, Status: 'Submitted' }, assignment), null);
    assert.equal(_test.getObjectiveAssignmentPercent({ ...submission, Answers: [{ Score: 2 }] }, assignment), null);
    assert.equal(_test.getObjectiveAssignmentPercent(submission, {
        Questions: [{ Type: 'Essay', Score: 5 }]
    }), null);
    assert.equal(_test.getObjectiveAssignmentPercent({ ...submission, TotalScore: 3 }, assignment), null);
    assert.equal(_test.getObjectiveAssignmentPercent({
        ...submission,
        Answers: [{ Score: 2 }, { Score: null }]
    }, assignment), null);
});

test('study streak uses only consecutive recorded StudyActivity dates', () => {
    assert.deepEqual(
        _test.calculateStreak(['2026-11-25', '2026-11-26', '2026-11-27'], '2026-11-28'),
        { days: 3, lastStudyDate: '2026-11-27' }
    );
    assert.deepEqual(
        _test.calculateStreak(['2026-11-24', '2026-11-27'], '2026-11-28'),
        { days: 1, lastStudyDate: '2026-11-27' }
    );
    assert.deepEqual(
        _test.calculateStreak([], '2026-11-28'),
        { days: 0, lastStudyDate: null }
    );
});

test('plan suggestions are tied to the selected goal and existing incomplete lessons', () => {
    const analytics = {
        aiEstimatedBands: {
            bySkill: [
                { skill: 'Writing', count: 2, averageEstimatedBand: 5.5 },
                { skill: 'Speaking', count: 1, averageEstimatedBand: 6.5 }
            ]
        },
        objectiveAssignments: { bySkill: [] },
        availability: {
            aiEstimatedBands: { state: 'available' },
            objectiveAssignments: { state: 'no_data' },
            lessons: { state: 'available' }
        }
    };
    const tasks = _test.generateTaskSuggestions({
        goal: {
            TargetBand: 7,
            TargetDate: new Date('2026-12-01T12:00:00.000Z'),
            WeeklyStudyDays: 4,
            FocusSkills: []
        },
        analytics,
        lessons: [
            { id: 'lesson-1', name: 'Essay structure', completed: false },
            { id: 'lesson-2', name: 'Reading review', completed: true }
        ]
    });
    assert.deepEqual(tasks.map(task => task.key), ['practice:Writing', 'lesson:lesson-1']);
    assert.match(tasks[0].reason, /Band Viết do AI ước tính/);
    assert.match(tasks[0].reason, /band 7 trước ngày 2026-12-01/);
    assert.match(tasks[1].reason, /khóa học bạn đã mua/);
    assert.equal(tasks.some(task => task.key === 'lesson:lesson-2'), false);
});

test('empty evidence creates a transparent baseline task instead of a random activity', () => {
    const tasks = _test.generateTaskSuggestions({
        goal: {
            TargetBand: 6.5,
            TargetDate: new Date('2026-12-01T12:00:00.000Z'),
            WeeklyStudyDays: 3,
            FocusSkills: []
        },
        analytics: {
            aiEstimatedBands: { bySkill: [] },
            objectiveAssignments: { bySkill: [] },
            availability: {
                aiEstimatedBands: { state: 'no_data' },
                objectiveAssignments: { state: 'no_data' },
                lessons: { state: 'no_courses' }
            }
        },
        lessons: []
    });
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].type, 'baseline');
    assert.match(tasks[0].reason, /Chưa có lượt luyện AI/);
});

test('persisted plan tasks use the model fields and only retain explicit completion', () => {
    const completionTime = new Date('2026-11-27T09:00:00.000Z');
    const tasks = _test.mapTasksToStoredShape([
        {
            key: 'practice:Writing',
            type: 'practice_skill',
            title: 'Practice Writing',
            reason: 'Based on recorded evidence.',
            skill: 'Writing',
            resourceId: null
        },
        {
            key: 'lesson:lesson-1',
            type: 'complete_lesson',
            title: 'Complete lesson',
            reason: 'Existing lesson.',
            skill: null,
            resourceId: 'lesson-1'
        }
    ], [{ Key: 'practice:Writing', Status: 'Completed', CompletedAt: completionTime }]);
    assert.equal(tasks[0].Key, 'practice:Writing');
    assert.equal(tasks[0].Type, 'practice_skill');
    assert.equal(tasks[0].Status, 'Completed');
    assert.equal(tasks[0].CompletedAt, completionTime);
    assert.equal(tasks[1].Status, 'Pending');
    assert.equal(tasks[1].Title, 'Complete lesson');
    assert.equal(Object.hasOwn(tasks[1], 'title'), false);
});

test('goal validation rejects invalid targets and unknown skills', () => {
    assert.throws(() => _test.normalizeGoalInput({
        targetBand: null, targetDate: '2026-12-01', weeklyStudyDays: 4, focusSkills: []
    }), /mức tăng 0,5/);
    assert.throws(() => _test.normalizeGoalInput({
        targetBand: 6.3, targetDate: '2026-12-01', weeklyStudyDays: 4, focusSkills: []
    }), /mức tăng 0,5/);
    assert.throws(() => _test.normalizeGoalInput({
        targetBand: 7, targetDate: '2026-12-01', weeklyStudyDays: 4, focusSkills: ['Vocabulary']
    }), /Kỹ năng ưu tiên/);
    assert.throws(() => _test.normalizeGoalInput({
        targetBand: 7, targetDate: '2026-02-31', weeklyStudyDays: 4, focusSkills: []
    }), /ngày mục tiêu hợp lệ/);
    const goal = _test.normalizeGoalInput({
        targetBand: 7, targetDate: '2026-12-01', weeklyStudyDays: 4, focusSkills: ['Writing']
    });
    assert.equal(goal.TargetBand, 7);
    assert.equal(goal.WeeklyStudyDays, 4);
    assert.deepEqual(goal.FocusSkills, ['Writing']);
    assert.equal(goal.TargetDate.toISOString().slice(0, 10), '2026-12-01');
});

test('analytics controller scopes its query to the authenticated JWT user', async () => {
    const original = analyticsService.buildAnalytics;
    let queriedUserId;
    analyticsService.buildAnalytics = async userId => {
        queriedUserId = userId;
        return { summary: {} };
    };
    try {
        const response = { json: body => body };
        await analyticsController.getAnalytics({
            user: { userId: 'authenticated-user' },
            params: { userId: 'attacker-selected-user' }
        }, response);
        assert.equal(queriedUserId, 'authenticated-user');
    } finally {
        analyticsService.buildAnalytics = original;
    }
});
