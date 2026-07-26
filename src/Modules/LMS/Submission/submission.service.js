const getSubmissionModel = require('./submission.model');
const getUserModel = require('../../auth/Account.model');
const getAssignmentModel = require('../Assignment/Assignment.model');

const createSubmission = async (data, currentUserId) => {
    const Submission = getSubmissionModel();
    
    const requiredFields = [
        'AssignmentID',
        'UserID'
    ];

    for (const field of requiredFields) {
        if (data[field] === undefined || data[field] === null) {
            throw new Error(`${field} is required`);
        }
    }

    // Authorize: user can only create submission for themselves
    if (data.UserID.toString() !== currentUserId.toString()) {
        throw new Error('Unauthorized: You can only create submission for yourself');
    }

    const submission = await Submission.create({
        AssignmentID: data.AssignmentID,
        UserID: data.UserID,
        StartTime: data.StartTime || new Date(),
        SubmitTime: data.SubmitTime || null,
        Duration: data.Duration || 0,
        Status: data.Status || "Doing",
        Answers: data.Answers || [],
        TotalScore: data.TotalScore || 0,
        BandScore: data.BandScore || 0,
        IsPassed: data.IsPassed ?? false
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

const getSubmissionById = async (id) => {
    const Submission = getSubmissionModel();
    const User = getUserModel();
    const Assignment = getAssignmentModel();
    
    const submission = await Submission.findById(id)
        .populate({ path: 'UserID', model: User, select: 'Email FullName Role' })
        .populate({ path: 'AssignmentID', model: Assignment, select: 'Title Skill TotalScore' });
    
    if (!submission) {
        throw new Error('Submission not found');
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

    // Authorize: only owner or admin (teacher) can update
    if (currentSubmission.UserID.toString() !== currentUserId.toString()) {
        throw new Error('Unauthorized: You can only update your own submission');
    }

    const submission = await Submission.findByIdAndUpdate(
        id,
        {
            Answers: data.Answers,
            Duration: data.Duration,
            Status: data.Status,
            TotalScore: data.TotalScore,
            BandScore: data.BandScore,
            IsPassed: data.IsPassed
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

    const submission = await Submission.findByIdAndUpdate(
        id,
        {
            Status: 'Submitted',
            SubmitTime: new Date()
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

    const submission = await Submission.findByIdAndUpdate(
        id,
        {
            TotalScore: data.TotalScore || currentSubmission.TotalScore,
            BandScore: data.BandScore || currentSubmission.BandScore,
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
