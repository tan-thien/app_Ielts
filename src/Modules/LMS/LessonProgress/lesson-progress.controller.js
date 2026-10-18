const progressService = require('./lesson-progress.service');

const completeLesson = async (req, res) => {
    try {
        const progress = await progressService.completeLesson(
            req.params.lessonId,
            req.user.userId
        );
        return res.json({ success: true, data: progress });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message
        });
    }
};

const getCourseProgress = async (req, res) => {
    try {
        const progress = await progressService.getCourseProgress(
            req.params.courseId,
            req.user.userId
        );
        return res.json({ success: true, data: progress });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message
        });
    }
};

const markCourseAccess = async (req, res) => {
    try {
        return res.json({ success: true, data: await progressService.markCourseAccess(req.params.courseId, req.user.userId) });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
};

const getStudyActivity = async (req, res) => {
    try {
        return res.json({ success: true, data: await progressService.getStudyActivity(req.user.userId, req.query.month) });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
};

module.exports = { completeLesson, getCourseProgress, markCourseAccess, getStudyActivity };
