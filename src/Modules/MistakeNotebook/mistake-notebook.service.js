const mongoose = require('mongoose');
const getMistakeModel = require('./mistake-notebook.model');
const getSubmissionModel = require('../LMS/Submission/submission.model');
const getAssignmentModel = require('../LMS/Assignment/Assignment.model');
const { gradeQuestionAnswer } = require('../LMS/Submission/submission.service');

const statuses = new Set(['New', 'Reviewing', 'Mastered']);
const legacyStatus = 'Learning';
const skills = new Set(['Reading', 'Listening', 'Writing', 'Speaking']);

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const idIsValid = value => mongoose.Types.ObjectId.isValid(value);
const hasKnownAnswer = value => {
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0 && value.every(item => hasKnownAnswer(item));
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
};
const hasStudentAnswer = value => {
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
};
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sourceKey = (type, submissionId, itemKey) => `${type}:${submissionId}:${itemKey}`;
const normalizeMistake = mistake => {
    const data = mistake?.toObject ? mistake.toObject() : { ...mistake };
    if (data.Status === legacyStatus) data.Status = 'Reviewing';
    if (Array.isArray(data.ReviewHistory)) {
        data.ReviewHistory = data.ReviewHistory.map(review => ({
            ...review,
            Status: review.Status === legacyStatus ? 'Reviewing' : review.Status
        }));
    }
    const history = data.ReviewHistory || [];
    if (!Number.isFinite(data.ReviewCount)) data.ReviewCount = history.length;
    if (!Number.isFinite(data.CorrectReviewCount)) {
        data.CorrectReviewCount = history.filter(review => review.WasCorrect === true).length;
    }
    if (!data.LastReviewedAt) data.LastReviewedAt = history[history.length - 1]?.ReviewedAt || null;
    return data;
};

const extractAssignmentMistakes = (submission, assignment) => {
    const skill = submission?.Skill || assignment?.Skill;
    if (!submission || submission.Status !== 'Graded' ||
        !['Reading', 'Listening'].includes(skill) ||
        (submission.Skill && assignment?.Skill !== submission.Skill) ||
        assignment?.Skill !== skill ||
        !Array.isArray(assignment.Questions) ||
        !Array.isArray(submission.Answers)) return [];

    return submission.Answers.flatMap(answer => {
        const question = assignment.Questions.find(item => Number(item.Order) === Number(answer.QuestionOrder));
        if (!question || !hasKnownAnswer(question.CorrectAnswer) ||
            !hasStudentAnswer(answer.Answer) || ['Essay', 'Speaking'].includes(question.Type)) return [];
        const maxScore = Number(question.Score);
        if (!Number.isFinite(maxScore) || maxScore <= 0) return [];
        let score;
        try {
            score = gradeQuestionAnswer(question, answer.Answer);
        } catch {
            return [];
        }
        if (!Number.isFinite(score) || score >= maxScore) return [];

        return [{
            SourceKey: sourceKey('assignment', submission._id, `question:${question.Order}`),
            SourceType: 'Assignment',
            SourceSubmissionID: submission._id,
            AssignmentID: assignment._id,
            Skill: skill,
            QuestionOrder: question.Order,
            SourceTitle: assignment.Title || '',
            Question: question.Question || question.Title || '',
            OriginalAnswer: answer.Answer,
            CorrectAnswer: question.CorrectAnswer
        }];
    });
};

const isSuccessfulEvaluation = (submission, answer, expectedKind) => {
    const result = answer?.AIReview;
    return submission?.Status === 'Graded' &&
        submission.PracticeType === (expectedKind === 'writing' ? 'Writing' : 'Speaking') &&
        submission.Skill === (expectedKind === 'writing' ? 'Writing' : 'Speaking') &&
        result?.version === 2 &&
        result.kind === expectedKind &&
        typeof result.estimatedOverallBand === 'number' &&
        Number.isFinite(result.estimatedOverallBand) &&
        result.estimatedOverallBand >= 0 && result.estimatedOverallBand <= 9 &&
        Array.isArray(result.criteria) && result.criteria.length === 4 &&
        typeof result.generalFeedback === 'string' && result.generalFeedback.trim().length > 0 &&
        Array.isArray(result.actionPlan) && result.actionPlan.length > 0 &&
        Array.isArray(result.priorityErrors) &&
        (expectedKind !== 'speaking' ||
            (result.transcriptionStatus === 'clear' &&
                typeof result.transcript === 'string' && result.transcript.trim().length > 0));
};

const extractAIMistakes = (submission, answer) => {
    const kind = submission?.PracticeType === 'Writing' ? 'writing' : 'speaking';
    if (!isSuccessfulEvaluation(submission, answer, kind)) return [];
    const evaluation = answer.AIReview;
    const studentText = typeof answer.Answer === 'string'
        ? answer.Answer
        : (kind === 'speaking' ? evaluation.transcript : '');

    return evaluation.priorityErrors.flatMap((error, index) => {
        if (!error || typeof error !== 'object' ||
            typeof error.type !== 'string' || !error.type.trim() ||
            typeof error.explanation !== 'string' || !error.explanation.trim() ||
            typeof error.suggestion !== 'string' || !error.suggestion.trim()) return [];
        const quote = typeof error.quote === 'string' ? error.quote.trim() : '';
        const hasVerifiableQuote = quote &&
            studentText.toLocaleLowerCase().includes(quote.toLocaleLowerCase());
        const pronunciationEvidence = kind === 'speaking' && !quote &&
            /pronunciation/i.test(error.type) &&
            typeof error.location === 'string' && error.location.trim();
        if (!hasVerifiableQuote && !pronunciationEvidence) return [];

        return [{
            SourceKey: sourceKey('ai', submission._id, `answer:${answer.QuestionOrder}:error:${index}`),
            SourceType: 'AI',
            SourceSubmissionID: submission._id,
            AssignmentID: null,
            Skill: submission.Skill,
            QuestionOrder: answer.QuestionOrder,
            AIErrorIndex: index,
            SourceTitle: submission.TaskType || submission.PracticeType || '',
            Question: submission.Prompt || '',
            OriginalAnswer: studentText,
            CorrectAnswer: null,
            ErrorType: error.type.trim().slice(0, 100),
            ErrorQuote: quote.slice(0, 500),
            Explanation: error.explanation.trim().slice(0, 1000),
            Suggestion: error.suggestion.trim().slice(0, 1000)
        }];
    });
};

const getImportCandidates = (submission, assignment) => {
    if (!submission || submission.Status !== 'Graded') return [];
    if (['Reading', 'Listening'].includes(submission.Skill || assignment?.Skill)) {
        return extractAssignmentMistakes(submission, assignment);
    }
    if (!['Writing', 'Speaking'].includes(submission.Skill) ||
        submission.PracticeType !== submission.Skill ||
        !Array.isArray(submission.Answers)) return [];
    return submission.Answers.flatMap(answer => extractAIMistakes(submission, answer));
};

const listImportSources = async ownerId => {
    const Submission = getSubmissionModel();
    const Assignment = getAssignmentModel();
    const submissions = await Submission.find({
        UserID: ownerId,
        Status: 'Graded',
        $or: [
            { Skill: { $in: ['Reading', 'Listening'] } },
            { AssignmentID: { $exists: true, $ne: null }, Skill: { $in: [null, ''] } },
            { PracticeType: { $in: ['Writing', 'Speaking'] } }
        ]
    }).sort({ createdAt: -1 }).limit(50)
        .select('_id Skill PracticeType Status TaskType Prompt AssignmentID Answers createdAt')
        .lean();
    const assignmentIds = submissions
        .filter(item => item.AssignmentID)
        .map(item => item.AssignmentID);
    const assignments = assignmentIds.length
        ? await Assignment.find({ _id: { $in: assignmentIds }, IsDeleted: { $ne: true } }).select('_id Title Skill Questions').lean()
        : [];
    const assignmentById = new Map(assignments.map(item => [String(item._id), item]));

    return submissions.flatMap(submission => {
        const assignment = submission.AssignmentID
            ? assignmentById.get(String(submission.AssignmentID))
            : null;
        const count = getImportCandidates(submission, assignment).length;
        return count ? [{
            _id: String(submission._id),
            Skill: submission.Skill || assignment?.Skill,
            SourceTitle: assignment?.Title || submission.TaskType || submission.Prompt || submission.PracticeType,
            createdAt: submission.createdAt,
            ImportableCount: count
        }] : [];
    });
};

const importSubmission = async (submissionId, ownerId) => {
    if (!idIsValid(submissionId)) throw httpError(400, 'Invalid source submission id');
    const Submission = getSubmissionModel();
    const Assignment = getAssignmentModel();
    const source = await Submission.findOne({ _id: submissionId, UserID: ownerId }).lean();
    if (!source) throw httpError(404, 'Source submission not found');
    let assignment = null;
    if (source.AssignmentID) {
        assignment = await Assignment.findOne({
            _id: source.AssignmentID,
            IsDeleted: { $ne: true }
        }).lean();
    }
    const candidates = getImportCandidates(source, assignment);
    if (!candidates.length) {
        return { imported: 0, duplicates: 0, ignored: 0 };
    }
    const Mistake = getMistakeModel();
    let imported = 0;
    let duplicates = 0;
    for (const candidate of candidates) {
        try {
            await Mistake.create({ ...candidate, OwnerID: ownerId });
            imported += 1;
        } catch (error) {
            if (error.code === 11000) duplicates += 1;
            else throw error;
        }
    }
    return { imported, duplicates, ignored: 0 };
};

const listMistakes = async (ownerId, query = {}) => {
    const Mistake = getMistakeModel();
    const requestedPage = Number(query.page);
    const pageNumber = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const limit = Math.min(100, Math.max(1, Math.floor(Number(query.limit) || 20)));
    const filter = { OwnerID: ownerId };
    if (query.status) {
        if (!statuses.has(query.status)) throw httpError(400, 'Invalid mistake status');
        filter.Status = query.status === 'Reviewing'
            ? { $in: ['Reviewing', legacyStatus] }
            : query.status;
    }
    if (query.skill) {
        if (!skills.has(query.skill)) throw httpError(400, 'Invalid skill');
        filter.Skill = query.skill;
    }
    if (typeof query.search === 'string' && query.search.trim()) {
        const pattern = new RegExp(escapeRegex(query.search.trim().slice(0, 100)), 'i');
        filter.$or = ['SourceTitle', 'Question', 'ErrorType', 'ErrorQuote', 'Explanation', 'Suggestion', 'Note']
            .map(field => ({ [field]: pattern }));
    }
    const total = await Mistake.countDocuments(filter);
    const totalPages = Math.ceil(total / limit);
    const page = Math.min(pageNumber, Math.max(1, totalPages));
    const items = await Mistake.find(filter).sort({ NextReviewAt: 1, createdAt: -1 })
        .skip((page - 1) * limit).limit(limit).lean();
    return { items: items.map(normalizeMistake), page, limit, total, totalPages };
};

const updateMistake = async (id, ownerId, input = {}) => {
    if (!idIsValid(id)) throw httpError(400, 'Invalid mistake id');
    const updates = {};
    if (Object.prototype.hasOwnProperty.call(input, 'Note')) {
        if (typeof input.Note !== 'string' || input.Note.length > 2000) throw httpError(400, 'Note must be 2000 characters or fewer');
        updates.Note = input.Note;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'Status')) {
        if (!statuses.has(input.Status)) throw httpError(400, 'Invalid mistake status');
        updates.Status = input.Status;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'NextReviewAt')) {
        if (input.NextReviewAt === null || input.NextReviewAt === '') updates.NextReviewAt = null;
        else {
            const date = new Date(input.NextReviewAt);
            if (Number.isNaN(date.getTime())) throw httpError(400, 'Invalid review date');
            updates.NextReviewAt = date;
        }
    }
    if (!Object.keys(updates).length) throw httpError(400, 'No editable fields supplied');
    const mistake = await getMistakeModel().findOneAndUpdate(
        { _id: id, OwnerID: ownerId },
        { $set: updates },
        { new: true, runValidators: true }
    );
    if (!mistake) throw httpError(404, 'Mistake not found');
    return normalizeMistake(mistake);
};

const reviewUpdate = (mistake, wasCorrect, now = new Date()) => {
    const reviewCount = (Number(mistake.ReviewCount) || 0) + 1;
    const correctReviewCount = (Number(mistake.CorrectReviewCount) || 0) + (wasCorrect ? 1 : 0);
    const intervalDays = wasCorrect
        ? Math.min(30, 2 ** Math.min(correctReviewCount, 5))
        : 1;
    const nextReviewAt = new Date(now.getTime() + intervalDays * 86400000);
    return {
        Status: wasCorrect && mistake.Status === 'Mastered' ? 'Mastered' : 'Reviewing',
        LastReviewedAt: now,
        ReviewCount: reviewCount,
        CorrectReviewCount: correctReviewCount,
        NextReviewAt: nextReviewAt,
        History: {
            ReviewedAt: now,
            WasCorrect: wasCorrect,
            Status: wasCorrect && mistake.Status === 'Mastered' ? 'Mastered' : 'Reviewing',
            Note: '',
            NextReviewAt: nextReviewAt
        }
    };
};

const recordReview = async (id, ownerId, input = {}) => {
    if (!idIsValid(id)) throw httpError(400, 'Invalid mistake id');
    if (typeof input.WasCorrect !== 'boolean') throw httpError(400, 'WasCorrect must be a boolean');
    if (input.Note !== undefined &&
        (typeof input.Note !== 'string' || input.Note.length > 1000)) {
        throw httpError(400, 'Review note must be 1000 characters or fewer');
    }
    const Mistake = getMistakeModel();
    const mistake = await Mistake.findOne({ _id: id, OwnerID: ownerId });
    if (!mistake) throw httpError(404, 'Mistake not found');
    const update = reviewUpdate(mistake, input.WasCorrect);
    mistake.Status = update.Status;
    mistake.LastReviewedAt = update.LastReviewedAt;
    mistake.ReviewCount = update.ReviewCount;
    mistake.CorrectReviewCount = update.CorrectReviewCount;
    mistake.NextReviewAt = update.NextReviewAt;
    mistake.ReviewHistory.push({ ...update.History, Note: input.Note || '' });
    if (mistake.ReviewHistory.length > 100) mistake.ReviewHistory.splice(0, mistake.ReviewHistory.length - 100);
    await mistake.save();
    return normalizeMistake(mistake);
};

const deleteMistake = async (id, ownerId) => {
    if (!idIsValid(id)) throw httpError(400, 'Invalid mistake id');
    const result = await getMistakeModel().deleteOne({ _id: id, OwnerID: ownerId });
    if (!result.deletedCount) throw httpError(404, 'Mistake not found');
    return { deleted: true };
};

module.exports = {
    listImportSources,
    importSubmission,
    listMistakes,
    updateMistake,
    recordReview,
    deleteMistake,
    _test: { hasKnownAnswer, extractAssignmentMistakes, isSuccessfulEvaluation, extractAIMistakes, getImportCandidates, reviewUpdate }
};
