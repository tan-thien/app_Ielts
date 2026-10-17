const getSubmissionModel = require('./submission.model');
const getUserModel = require('../../auth/Account.model');
const getAssignmentModel = require('../Assignment/Assignment.model');
const getLessonModel = require('../lesson/lesson.model');
const orderService = require('../Order/order.service');

const parseStoredAnswer = value => {
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
};

const normalizeAnswer = value => {
    if (typeof value === 'string') {
        return value.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,!?;:]+$/g, '');
    }
    if (Array.isArray(value)) return value.map(normalizeAnswer);
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.keys(value).sort().map(key => [key, normalizeAnswer(value[key])])
        );
    }
    return value;
};

const answersEqual = (left, right) =>
    JSON.stringify(normalizeAnswer(left)) === JSON.stringify(normalizeAnswer(right));

const matchesAnswer = (expected, actual) =>
    Array.isArray(expected)
        ? expected.some(acceptedAnswer => answersEqual(acceptedAnswer, actual))
        : answersEqual(expected, actual);

const normalizeChoiceAnswer = (question, value) => {
    if (Array.isArray(value)) {
        return value.map(item => normalizeChoiceAnswer(question, item));
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, item]) => [key, normalizeChoiceAnswer(question, item)])
        );
    }
    if (typeof value !== 'string') return value;

    const normalizedValue = normalizeAnswer(value);
    const choiceByKey = (question.Choices || []).find(
        choice => normalizeAnswer(choice.Key) === normalizedValue
    );
    if (choiceByKey) return normalizeAnswer(choiceByKey.Key);

    const choiceByContent = (question.Choices || []).find(
        choice => normalizeAnswer(choice.Content) === normalizedValue
    );
    return choiceByContent
        ? normalizeAnswer(choiceByContent.Key)
        : normalizedValue;
};

const gradeQuestionAnswer = (question, submittedAnswer) => {
    if (['Essay', 'Speaking'].includes(question.Type)) return 0;

    const expected = normalizeChoiceAnswer(question, parseStoredAnswer(question.CorrectAnswer));
    const actual = normalizeChoiceAnswer(question, parseStoredAnswer(submittedAnswer));
    const points = Math.max(0, Number(question.Score) || 0);
    if (expected === null || expected === undefined || actual === null || actual === undefined || actual === '') {
        return 0;
    }

    if (Array.isArray(expected) && Array.isArray(actual)) {
        if (!expected.length) return 0;
        const isCheckbox = question.Type === 'Checkbox' ||
            (question.AnswerCount > 1 &&
                question.Type !== 'Ordering' &&
                (question.Choices || []).length > 0);
        if (!isCheckbox && expected.length === actual.length) {
            const matched = expected.filter((answer, index) => matchesAnswer(answer, actual[index])).length;
            return Number(((matched / expected.length) * points).toFixed(2));
        }
        const expectedNormalized = expected.map(normalizeAnswer);
        const actualNormalized = actual.map(normalizeAnswer);
        const correctCount = expectedNormalized.filter(answer => actualNormalized.some(item => matchesAnswer(answer, item))).length;
        const incorrectCount = actualNormalized.filter(answer => !expectedNormalized.some(item => matchesAnswer(answer, item))).length;
        const earnedCount = Math.max(0, correctCount - incorrectCount);
        return Number(((earnedCount / expected.length) * points).toFixed(2));
    }
    if (Array.isArray(expected) && !Array.isArray(actual)) {
        return expected.some(answer => answersEqual(answer, actual)) ? points : 0;
    }

    return answersEqual(expected, actual) ? points : 0;
};

const getAvailableAssignment = async (assignmentId, currentUserId, now = new Date()) => {
    const Assignment = getAssignmentModel();
    const assignment = await Assignment.findOne({ _id: assignmentId, IsDeleted: false });

    if (!assignment || !assignment.IsOpen) {
        throw new Error('Assignment is not available');
    }
    if (assignment.StartDate && assignment.StartDate > now) {
        throw new Error('Assignment has not started yet');
    }
    if (assignment.EndDate && assignment.EndDate < now) {
        throw new Error('Assignment has ended');
    }

    let courseId = assignment.CourseID;
    if (!courseId && assignment.LessonID) {
        const lesson = await getLessonModel().findById(assignment.LessonID).select('CourseID');
        courseId = lesson?.CourseID;
    }
    if (!courseId || !(await orderService.hasCourseAccess(courseId, currentUserId))) {
        throw new Error('A successful course payment is required to submit this assignment');
    }

    return assignment;
};

const normalizeSubmittedAnswers = (questions, submittedAnswers) => {
    if (!Array.isArray(submittedAnswers)) {
        throw new Error('Answers must be an array');
    }

    const questionOrders = new Set(questions.map(question => question.Order));
    const submittedOrders = new Set();
    return submittedAnswers.map(answer => {
        if (
            !answer ||
            !questionOrders.has(answer.QuestionOrder) ||
            submittedOrders.has(answer.QuestionOrder)
        ) {
            throw new Error('Invalid or duplicate question order in answers');
        }
        submittedOrders.add(answer.QuestionOrder);
        return {
            QuestionOrder: answer.QuestionOrder,
            Answer: answer.Answer,
            FileUrl: answer.FileUrl || ''
        };
    });
};

const createSubmission = async (data, currentUserId) => {
    const Submission = getSubmissionModel();
    const assignment = await getAvailableAssignment(data.AssignmentID, currentUserId);
    const existingAttempts = await Submission.countDocuments({
        AssignmentID: assignment._id,
        UserID: currentUserId
    });

    if (assignment.AttemptLimit > 0 && existingAttempts >= assignment.AttemptLimit) {
        throw new Error('Assignment attempt limit reached');
    }
    if (await Submission.exists({
        AssignmentID: assignment._id,
        UserID: currentUserId,
        Status: 'Doing'
    })) {
        throw new Error('You already have an attempt in progress');
    }

    const submission = await Submission.create({
        AssignmentID: assignment._id,
        UserID: currentUserId,
        StartTime: new Date(),
        Status: 'Doing',
        Answers: [],
        TotalScore: 0,
        BandScore: 0,
        IsPassed: false
    });

    return submission;
};

const getAllSubmissions = async () => {
    const Submission = getSubmissionModel();
    const User = getUserModel();
    const Assignment = getAssignmentModel();
    
    const submissions = await Submission.find()
        .populate({ path: 'UserID', model: User, select: 'Email FullName' })
        .populate({ path: 'AssignmentID', model: Assignment, select: 'Title Skill' })
        .sort({ createdAt: -1 });

    return submissions;
};

const getSubmissionById = async (id, currentUserId, userRole) => {
    const Submission = getSubmissionModel();
    const User = getUserModel();
    const Assignment = getAssignmentModel();
    
    const submission = await Submission.findById(id)
        .populate({ path: 'UserID', model: User, select: 'Email FullName Role' })
        .populate({ path: 'AssignmentID', model: Assignment, select: 'Title Skill TotalScore' });
    
    if (!submission) {
        throw new Error('Submission not found');
    }

    if (
        userRole !== 'admin' &&
        userRole !== 'teacher' &&
        (submission.UserID?._id || submission.UserID).toString() !== currentUserId.toString()
    ) {
        throw new Error('Unauthorized: You can only view your own submission');
    }
    
    return submission;
};

const getSubmissionByAssignment = async (assignmentId) => {
    const Submission = getSubmissionModel();
    const User = getUserModel();
    
    const submissions = await Submission.find({ AssignmentID: assignmentId })
        .populate({ path: 'UserID', model: User, select: 'Email FullName' })
        .sort({ createdAt: -1 });

    return submissions;
};

const getSubmissionByUser = async (userId) => {
    const Submission = getSubmissionModel();
    const Assignment = getAssignmentModel();
    
    const submissions = await Submission.find({ UserID: userId })
        .populate({ path: 'AssignmentID', model: Assignment, select: 'Title Skill' })
        .sort({ createdAt: -1 });

    return submissions;
};

const getSubmissionByMe = async (currentUserId) => {
    const Submission = getSubmissionModel();
    const Assignment = getAssignmentModel();
    
    const submissions = await Submission.find({ UserID: currentUserId })
        .populate({ path: 'AssignmentID', model: Assignment, select: 'Title Skill TotalScore' })
        .sort({ createdAt: -1 });

    return submissions;
};

const updateSubmission = async (id, data, currentUserId) => {
    const Submission = getSubmissionModel();

    // Get the current submission to check authorization
    const currentSubmission = await Submission.findById(id);
    if (!currentSubmission) {
        throw new Error('Submission not found');
    }

    if (currentSubmission.UserID.toString() !== currentUserId.toString()) {
        throw new Error('Unauthorized: You can only update your own submission');
    }

    if (currentSubmission.Status !== 'Doing') {
        throw new Error('Only submissions in progress can be updated');
    }

    if (!Array.isArray(data.Answers)) {
        throw new Error('Answers must be an array');
    }

    const assignment = await getAvailableAssignment(currentSubmission.AssignmentID, currentUserId);

    const now = new Date();
    if (assignment.EndDate && assignment.EndDate < now) {
        throw new Error('Assignment has ended');
    }
    if (
        assignment.Duration > 0 &&
        now.getTime() - currentSubmission.StartTime.getTime() > assignment.Duration * 60 * 1000
    ) {
        throw new Error('Assignment time limit exceeded');
    }

    const answers = normalizeSubmittedAnswers(assignment.Questions, data.Answers);

    const submission = await Submission.findOneAndUpdate(
        { _id: id, UserID: currentUserId, Status: 'Doing' },
        {
            Answers: answers
        },
        {
            new: true
        }
    );

    if (!submission) throw new Error('Submission is no longer in progress');

    return submission;
};

const submitAssignment = async (id, currentUserId, submittedAnswers) => {
    const Submission = getSubmissionModel();

    // Get the current submission to check authorization
    const currentSubmission = await Submission.findById(id);
    if (!currentSubmission) {
        throw new Error('Submission not found');
    }

    // Authorize: only owner can submit
    if (currentSubmission.UserID.toString() !== currentUserId.toString()) {
        throw new Error('Unauthorized: You can only submit your own assignment');
    }

    if (currentSubmission.Status !== 'Doing') {
        throw new Error('Submission has already been submitted');
    }

    const assignment = await getAvailableAssignment(currentSubmission.AssignmentID, currentUserId);
    const draftAnswers = submittedAnswers === undefined
        ? currentSubmission.Answers.map(answer => ({
            QuestionOrder: answer.QuestionOrder,
            Answer: answer.Answer,
            FileUrl: answer.FileUrl || ''
        }))
        : normalizeSubmittedAnswers(assignment.Questions, submittedAnswers);
    const actualElapsedSeconds = Math.max(0, Math.floor(
        (Date.now() - currentSubmission.StartTime.getTime()) / 1000
    ));
    const elapsedSeconds = assignment.Duration > 0
        ? Math.min(actualElapsedSeconds, assignment.Duration * 60)
        : actualElapsedSeconds;

    const answerByOrder = new Map(
        draftAnswers.map(answer => [answer.QuestionOrder, answer])
    );
    let earnedScore = 0;
    let possibleScore = 0;
    let needsTeacherReview = false;
    const gradedAnswers = assignment.Questions.map(question => {
        const answer = answerByOrder.get(question.Order);
        const isManualQuestion = ['Essay', 'Speaking'].includes(question.Type);
        const questionScore = Math.max(0, Number(question.Score) || 0);
        possibleScore += questionScore;

        if (isManualQuestion) {
            needsTeacherReview = true;
            return {
                QuestionOrder: question.Order,
                Answer: answer?.Answer ?? '',
                FileUrl: answer?.FileUrl || '',
                Score: 0
            };
        }

        const score = gradeQuestionAnswer(question, answer?.Answer);
        earnedScore += score;
        return {
            QuestionOrder: question.Order,
            Answer: answer?.Answer ?? '',
            FileUrl: answer?.FileUrl || '',
            Score: score
        };
    });
    const bandScore = possibleScore > 0
        ? Number(((earnedScore / possibleScore) * (Number(assignment.TotalScore) || 0)).toFixed(2))
        : 0;

    const submission = await Submission.findOneAndUpdate(
        { _id: id, UserID: currentUserId, Status: 'Doing' },
        {
            Answers: gradedAnswers,
            Status: needsTeacherReview ? 'Submitted' : 'Graded',
            SubmitTime: new Date(),
            Duration: elapsedSeconds,
            TotalScore: earnedScore,
            BandScore: bandScore
        },
        {
            new: true
        }
    );

    if (!submission) throw new Error('Submission is no longer in progress');

    return submission;
};

const deleteSubmission = async (id, currentUserId) => {
    const Submission = getSubmissionModel();
    
    // Get the current submission to check authorization
    const currentSubmission = await Submission.findById(id);
    if (!currentSubmission) {
        throw new Error('Submission not found');
    }

    // Authorize: only owner can delete
    if (currentSubmission.UserID.toString() !== currentUserId.toString()) {
        throw new Error('Unauthorized: You can only delete your own submission');
    }
    
    const submission = await Submission.findByIdAndDelete(id);
    
    if (!submission) {
        throw new Error('Submission not found');
    }
    
    return submission;
};

const reviewAI = async (id, data) => {
    const Submission = getSubmissionModel();

    // Get the current submission
    const currentSubmission = await Submission.findById(id);
    if (!currentSubmission) {
        throw new Error('Submission not found');
    }
    if (currentSubmission.Status === 'Doing') {
        throw new Error('Cannot review a submission that is still in progress');
    }

    // Update AI review for each answer
    const answers = currentSubmission.Answers;
    if (data.Answers && Array.isArray(data.Answers)) {
        for (let i = 0; i < data.Answers.length; i++) {
            if (answers[i]) {
                answers[i].AIReview = {
                    Band: data.Answers[i].Band || 0,
                    Feedback: data.Answers[i].Feedback || ""
                };
            }
        }
    }

    const submission = await Submission.findByIdAndUpdate(
        id,
        {
            Answers: answers,
            Status: 'Graded'
        },
        {
            new: true
        }
    );

    if (!submission) {
        throw new Error('Submission not found');
    }

    return submission;
};

const reviewTeacher = async (id, data) => {
    const Submission = getSubmissionModel();

    // Get the current submission
    const currentSubmission = await Submission.findById(id);
    if (!currentSubmission) {
        throw new Error('Submission not found');
    }
    if (currentSubmission.Status === 'Doing') {
        throw new Error('Cannot review a submission that is still in progress');
    }

    // Update Teacher review for each answer
    const answers = currentSubmission.Answers;
    if (data.Answers && Array.isArray(data.Answers)) {
        for (let i = 0; i < data.Answers.length; i++) {
            if (answers[i]) {
                answers[i].TeacherReview = {
                    TeacherID: data.TeacherID,
                    Band: data.Answers[i].Band || 0,
                    Feedback: data.Answers[i].Feedback || ""
                };
            }
        }
    }

    const submission = await Submission.findByIdAndUpdate(
        id,
        {
            Answers: answers,
            Status: 'Graded'
        },
        {
            new: true
        }
    );

    if (!submission) {
        throw new Error('Submission not found');
    }

    return submission;
};

const updateScore = async (id, data) => {
    const Submission = getSubmissionModel();

    // Get the current submission
    const currentSubmission = await Submission.findById(id);
    if (!currentSubmission) {
        throw new Error('Submission not found');
    }
    if (currentSubmission.Status === 'Doing') {
        throw new Error('Cannot grade a submission that is still in progress');
    }

    const submission = await Submission.findByIdAndUpdate(
        id,
        {
            TotalScore: data.TotalScore ?? currentSubmission.TotalScore,
            BandScore: data.BandScore ?? currentSubmission.BandScore,
            IsPassed: data.IsPassed ?? currentSubmission.IsPassed,
            Status: 'Graded'
        },
        {
            new: true
        }
    );

    if (!submission) {
        throw new Error('Submission not found');
    }

    return submission;
};

module.exports = { createSubmission, getAllSubmissions, getSubmissionById, getSubmissionByAssignment, getSubmissionByUser, getSubmissionByMe, updateSubmission, submitAssignment, reviewAI, reviewTeacher, updateScore, deleteSubmission, gradeQuestionAnswer };
