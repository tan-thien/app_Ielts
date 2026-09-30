const lessonService = require("./lesson.service");

const createLesson = async (req, res) => {
    try {

        console.log("REQ.USER:", req.user);

        const data = {
            ...req.body,
            UserCreate: req.user.userId
        };

        console.log("UserCreate:", data.UserCreate);

        const lesson = await lessonService.createLesson(data);

        return res.status(201).json({
            message: "Lesson created successfully",
            lesson
        });

    } catch (error) {

        console.error("Create lesson error:", error);

        return res.status(500).json({
            message: error.message
        });
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

        const lesson = await lessonService.deleteLesson(req.params.id);

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