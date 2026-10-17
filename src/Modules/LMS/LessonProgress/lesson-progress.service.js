const getLessonModel = require('../lesson/lesson.model');
const getLessonProgressModel = require('./lesson-progress.model');
const orderService = require('../Order/order.service');

const completeLesson = async (lessonId, userId) => {
    const Lesson = getLessonModel();
    const LessonProgress = getLessonProgressModel();
    const lesson = await Lesson.findOne({ _id: lessonId, IsDeleted: false });
    if (!lesson) {
        const error = new Error('Lesson not found');
        error.statusCode = 404;
        throw error;
    }
    if (!(await orderService.hasCourseAccess(lesson.CourseID, userId))) {
        const error = new Error('A successful course payment is required to update lesson progress');
        error.statusCode = 403;
        throw error;
    }

    const progress = await LessonProgress.findOneAndUpdate(
        { UserID: userId, LessonID: lesson._id },
        {
            $setOnInsert: {
                UserID: userId,
                CourseID: lesson.CourseID,
                LessonID: lesson._id,
                CompletedAt: new Date()
            }
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    return progress;
};

const getCourseProgress = async (courseId, userId) => {
    if (!(await orderService.hasCourseAccess(courseId, userId))) {
        const error = new Error('A successful course payment is required to view lesson progress');
        error.statusCode = 403;
        throw error;
    }
    const LessonProgress = getLessonProgressModel();
    return LessonProgress.find({ CourseID: courseId, UserID: userId })
        .select('LessonID CompletedAt')
        .lean();
};

module.exports = { completeLesson, getCourseProgress };
