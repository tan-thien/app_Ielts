const { createCourse, updateCourse, getAllCourse, getCourseById, deleteCourse } = require('./Course.service');

const createCourseController = async (req, res) => {
    try {
        const data = req.body;
        data.UserCreate = req.user.userId;
        const course = await createCourse(data);
        return res.status(201).json({success: true, message: 'Create course successfully', data: course });

    } catch (error) {
        return res.status(400).json({ success: false,message: error.message});
    }
};

const updateCourseController = async (req, res) => {
    try {
        const id = req.params.id;
        const data = req.body;
        const course = await updateCourse(id, data);

        return res.status(200).json({ success: true, message: 'Update course successfully', data: course});

    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};
const getCourseController = async (req, res) => {
    try {
        const course = await getAllCourse();
        return res.status(200).json({ success: true, message: 'Get course successfully', data: course });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};
const getCourseByIdController = async (req, res) => {
    try {
        const id = req.params.id;
        const course = await getCourseById(id);
        return res.status(200).json({ success: true, message: 'Get course successfully', data: course });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};
const deleteCourseController = async (req, res) => {
    try {
        const id = req.params.id;
        const course = await deleteCourse(id);
        return res.status(200).json({ success: true, message: 'Delete course successfully', data: course });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};
module.exports = { createCourseController, updateCourseController, getCourseController, getCourseByIdController, deleteCourseController };