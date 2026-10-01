const getSubmissionModel = require('./submission.model');
const getUserModel = require('../../auth/Account.model');
const getAssignmentModel = require('../Assignment/Assignment.model');

const getAvailableAssignment = async (assignmentId, now = new Date()) => {
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

    return assignment;
};

const createSubmission = async (data, currentUserId) => {
    const Submission = getSubmissionModel();
    const assignment = await getAvailableAssignment(data.AssignmentID);
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

    const Assignment = getAssignmentModel();
    const assignment = await Assignment.findById(currentSubmission.AssignmentID);
    if (!assignment || assignment.IsDeleted) {
        throw new Error('Assignment not found');
    }

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

    const questionOrders = new Set(assignment.Questions.map(question => question.Order));
    const submittedOrders = new Set();
    const answers = data.Answers.map(answer => {
        if (!questionOrders.has(answer.QuestionOrder) || submittedOrders.has(answer.QuestionOrder)) {
            throw new Error('Invalid or duplicate question order in answers');
        }
        submittedOrders.add(answer.QuestionOrder);
        return {
            QuestionOrder: answer.QuestionOrder,
            Answer: answer.Answer,
            FileUrl: answer.FileUrl || ''
        };
    });

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

const submitAssignment = async (id, currentUserId) => {
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

    await getAvailableAssignment(currentSubmission.AssignmentID);
    const elapsedSeconds = Math.max(0, Math.floor(
        (Date.now() - currentSubmission.StartTime.getTime()) / 1000
    ));

    const submission = await Submission.findOneAndUpdate(
        { _id: id, UserID: currentUserId, Status: 'Doing' },
        {
            Status: 'Submitted',
            SubmitTime: new Date(),
            Duration: elapsedSeconds
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

module.exports = { createSubmission, getAllSubmissions, getSubmissionById, getSubmissionByAssignment, getSubmissionByUser, getSubmissionByMe, updateSubmission, submitAssignment, reviewAI, reviewTeacher, updateScore, deleteSubmission };
