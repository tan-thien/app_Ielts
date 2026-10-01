const { createSubmission, getAllSubmissions, getSubmissionById, getSubmissionByAssignment, getSubmissionByUser, getSubmissionByMe, updateSubmission, submitAssignment, reviewAI, reviewTeacher, updateScore, deleteSubmission } = require('./submission.service');

const createSubmissionController = async (req, res) => {
    try {
        const data = req.body;
        data.UserID = req.user.userId;
        const submission = await createSubmission(data, req.user.userId);
        return res.status(201).json({ success: true, message: 'Create submission successfully', data: submission });

    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

const getAllSubmissionsController = async (req, res) => {
    try {
        const submission = await getAllSubmissions();
        return res.status(200).json({ success: true, message: 'Get submission successfully', data: submission });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

const getSubmissionByIdController = async (req, res) => {
    try {
        const id = req.params.id;
        const submission = await getSubmissionById(id, req.user.userId, req.user.role);
        return res.status(200).json({ success: true, message: 'Get submission successfully', data: submission });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

const getSubmissionByAssignmentController = async (req, res) => {
    try {
        const assignmentId = req.params.id;
        const submission = await getSubmissionByAssignment(assignmentId);
        return res.status(200).json({ success: true, message: 'Get submission successfully', data: submission });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

const getSubmissionByUserController = async (req, res) => {
    try {
        const userId = req.params.userId;
        const submission = await getSubmissionByUser(userId);
        return res.status(200).json({ success: true, message: 'Get submission successfully', data: submission });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

const getSubmissionByMeController = async (req, res) => {
    try {
        const submission = await getSubmissionByMe(req.user.userId);
        return res.status(200).json({ success: true, message: 'Get submission successfully', data: submission });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

const updateSubmissionController = async (req, res) => {
    try {
        const id = req.params.id;
        const data = req.body;
        const submission = await updateSubmission(id, data, req.user.userId);

        return res.status(200).json({ success: true, message: 'Update submission successfully', data: submission });

    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

const submitAssignmentController = async (req, res) => {
    try {
        const id = req.params.id;
        const submission = await submitAssignment(id, req.user.userId);

        return res.status(200).json({ success: true, message: 'Submit assignment successfully', data: submission });

    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

const deleteSubmissionController = async (req, res) => {
    try {
        const id = req.params.id;
        const submission = await deleteSubmission(id, req.user.userId);
        return res.status(200).json({ success: true, message: 'Delete submission successfully', data: submission });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

const reviewAIController = async (req, res) => {
    try {
        const id = req.params.id;
        const data = req.body;
        const submission = await reviewAI(id, data);
        return res.status(200).json({ success: true, message: 'AI review successfully', data: submission });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

const reviewTeacherController = async (req, res) => {
    try {
        const id = req.params.id;
        const data = req.body;
        data.TeacherID = req.user.userId;
        const submission = await reviewTeacher(id, data);
        return res.status(200).json({ success: true, message: 'Teacher review successfully', data: submission });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

const updateScoreController = async (req, res) => {
    try {
        const id = req.params.id;
        const data = req.body;
        const submission = await updateScore(id, data);
        return res.status(200).json({ success: true, message: 'Update score successfully', data: submission });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

module.exports = { createSubmissionController, getAllSubmissionsController, getSubmissionByIdController, getSubmissionByAssignmentController, getSubmissionByUserController, getSubmissionByMeController, updateSubmissionController, submitAssignmentController, reviewAIController, reviewTeacherController, updateScoreController, deleteSubmissionController };
