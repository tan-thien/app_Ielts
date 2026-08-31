const lessonService = require("./lesson.service");

const createLesson = async (req, res) => {
    try {
        const lesson = await lessonService.createLesson(req.body);
        return res.status(201).json({ success: true, message: "Lesson created successfully", data: lesson });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

const getAllLessons = async (req, res) => {
    try {
        const lessons = await lessonService.getAllLessons();
        return res.json({success: true,data: lessons});

    } catch (error) {
        return res.status(500).json({success: false,message: error.message});
    }
};

const getLessonById = async (req, res) => {
    try {

        const lesson = await lessonService.getLessonById(req.params.id);
        return res.json({success: true,data: lesson});

    } catch (error) {

        return res.status(404).json({success: false,message: error.message});
    }
};

const getLessonByCourseId = async (req, res) => {
    try {

        const lessons = await lessonService.getLessonByCourseId(req.params.courseId);
        return res.json({success: true,data: lessons});

    } catch (error) {
        return res.status(500).json({success: false,message: error.message});
    }
};

const updateLesson = async (req, res) => {
    try {
        const lesson = await lessonService.updateLesson(req.params.id,req.body);
        return res.json({success: true,message: "Lesson updated successfully",data: lesson });

    } catch (error) {
        return res.status(400).json({success: false,message: error.message});
    }
};

const deleteLesson = async (req, res) => {
    try {

        const lesson = await service.deleteLesson(req.params.id);

        res.json({
            success: true,
            message: "Delete lesson successfully",
            data: lesson
        });

    } catch (err) {

        res.status(400).json({
            success: false,
            message: err.message
        });

    }
};

module.exports = {createLesson,getAllLessons,getLessonById,getLessonByCourseId,updateLesson,deleteLesson};