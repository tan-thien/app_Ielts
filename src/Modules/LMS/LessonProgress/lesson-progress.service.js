const getLessonModel = require('../lesson/lesson.model');
const getLessonProgressModel = require('./lesson-progress.model');
const orderService = require('../Order/order.service');
const getStudyActivityModel = require('./study-activity.model');

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

const markCourseAccess = async (courseId, userId) => {
    if (!(await orderService.hasCourseAccess(courseId, userId))) {
        const error = new Error('A successful course payment is required to record study activity');
        error.statusCode = 403;
        throw error;
    }
    const Activity = getStudyActivityModel();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
    return Activity.findOneAndUpdate(
        { UserID: userId, CourseID: courseId, StudyDate: today },
        { $setOnInsert: { UserID: userId, CourseID: courseId, StudyDate: today } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
};

const getStudyActivity = async (userId, month) => {
    const Activity = getStudyActivityModel();
    const value = /^\d{4}-\d{2}$/.test(String(month || '')) ? String(month) : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
    return Activity.find({ UserID: userId, StudyDate: new RegExp(`^${value}-`) }).select('StudyDate CourseID').lean();
};

module.exports = { completeLesson, getCourseProgress, markCourseAccess, getStudyActivity };
