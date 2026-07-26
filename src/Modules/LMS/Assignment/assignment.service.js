const getAssignmentModel = require('./Assignment.model');
const getUserModel = require('../../auth/Account.model');
const { authorize } = require('../../../middlewares/authorize.middleware');

const createAssignment = async (data, currentUserId) => {
    const Assignment = getAssignmentModel();
    
    const requiredFields = [
        'Title',
        'Skill',
        'UserCreate'
    ];

    for (const field of requiredFields) {
        if (data[field] === undefined || data[field] === null) {
            throw new Error(`${field} is required`);
        }
    }

    // Authorize: user can only create assignment for themselves
    if (data.UserCreate.toString() !== currentUserId.toString()) {
        throw new Error('Unauthorized: You can only create assignment for yourself');
    }

    const assignment = await Assignment.create({
        Title: data.Title,
        Description: data.Description || "",
        Skill: data.Skill,
        AssignmentType: data.AssignmentType || "Practice",
        LessonID: data.LessonID || null,
        CourseID: data.CourseID || null,
        UserCreate: data.UserCreate,
        Duration: data.Duration || 0,
        TotalScore: data.TotalScore || 9,
        AttemptLimit: data.AttemptLimit || 0,
        StartDate: data.StartDate,
        EndDate: data.EndDate,
        Questions: data.Questions || [],
        IsOpen: data.IsOpen ?? false,
        IsDeleted: data.IsDeleted ?? false
    });

    return assignment;
};

const updateAssignment = async (id, data, currentUserId) => {
    const Assignment = getAssignmentModel();

    // Get the current assignment to check authorization
    const currentAssignment = await Assignment.findById(id);
    if (!currentAssignment) {
        throw new Error('Assignment not found');
    }

    // Authorize: only creator can update
    if (currentAssignment.UserCreate.toString() !== currentUserId.toString()) {
        throw new Error('Unauthorized: You can only update your own assignment');
    }

    const assignment = await Assignment.findByIdAndUpdate(
        id,
        {
            Title: data.Title,
            Description: data.Description,
            Skill: data.Skill,
            AssignmentType: data.AssignmentType,
            LessonID: data.LessonID,
            CourseID: data.CourseID,
            UserCreate: data.UserCreate,
            Duration: data.Duration,
            TotalScore: data.TotalScore,
            AttemptLimit: data.AttemptLimit,
            StartDate: data.StartDate,
            EndDate: data.EndDate,
            Questions: data.Questions,
            IsOpen: data.IsOpen,
            IsDeleted: data.IsDeleted
        },
        {
            new: true
        }
    );

    if (!assignment) {
        throw new Error('Assignment not found');
    }

    return assignment;
};

const getAllAssignments = async () => {
    const Assignment = getAssignmentModel();
    const User = getUserModel();
    
    const assignments = await Assignment.find({ IsDeleted: false })
        .populate({ path: 'UserCreate', model: User, select: 'Email' })
        .sort({ createdAt: -1 });

    return assignments;
};

const getAssignmentById = async (id) => {
    const Assignment = getAssignmentModel();
    const User = getUserModel();
    
    const assignment = await Assignment.findOne({ _id: id, IsDeleted: false })
        .populate({ path: 'UserCreate', model: User, select: 'Email Role' });
    
    if (!assignment) {
        throw new Error('Assignment not found');
    }
    
    return assignment;
};

const deleteAssignment = async (id, currentUserId) => {
    const Assignment = getAssignmentModel();
    
    // Get the current assignment to check authorization
    const currentAssignment = await Assignment.findById(id);
    if (!currentAssignment) {
        throw new Error('Assignment not found');
    }

    // Authorize: only creator can delete
    if (currentAssignment.UserCreate.toString() !== currentUserId.toString()) {
        throw new Error('Unauthorized: You can only delete your own assignment');
    }
    
    const assignment = await Assignment.findByIdAndUpdate(
        id,
        { IsDeleted: true },
        { new: true }
    );
    
    if (!assignment) {
        throw new Error('Assignment not found');
    }
    
    return assignment;
};

module.exports = { createAssignment, updateAssignment, getAllAssignments, getAssignmentById, deleteAssignment };
