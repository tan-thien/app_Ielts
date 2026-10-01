const { createAssignment, updateAssignment, getAllAssignments, getAssignmentById, deleteAssignment } = require('./assignment.service');

const createAssignmentController = async (req, res) => {
    try {
        const data = { ...req.body, UserCreate: req.user.userId };
        const assignment = await createAssignment(data, req.user.userId);
        return res.status(201).json({ success: true, message: 'Create assignment successfully', data: assignment });

    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

const updateAssignmentController = async (req, res) => {
    try {
        const id = req.params.id;
        const data = req.body;
        const assignment = await updateAssignment(id, data, req.user.userId);

        return res.status(200).json({ success: true, message: 'Update assignment successfully', data: assignment });

    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

const getAssignmentController = async (req, res) => {
    try {
        const assignment = await getAllAssignments(req.user.role);
        return res.status(200).json({ success: true, message: 'Get assignment successfully', data: assignment });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

const getAssignmentByIdController = async (req, res) => {
    try {
        const id = req.params.id;
        const assignment = await getAssignmentById(id, req.user.role);
        return res.status(200).json({ success: true, message: 'Get assignment successfully', data: assignment });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

const deleteAssignmentController = async (req, res) => {
    try {
        const id = req.params.id;
        const assignment = await deleteAssignment(id, req.user.userId);
        return res.status(200).json({ success: true, message: 'Delete assignment successfully', data: assignment });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

module.exports = { createAssignmentController, updateAssignmentController, getAssignmentController, getAssignmentByIdController, deleteAssignmentController };
