const getLessonModel = require('../lesson/lesson.model');
const getLessonDetailModel = require('../lesson/lesson_detail.model');
const getAssignmentModel = require('../Assignment/Assignment.model');
const orderService = require('./order.service');

const requirePaidCourse = (resourceType, resourceParam) => async (req, res, next) => {
    if (req.user.role === 'admin') return next();

    try {
        let lessonId = resourceType === 'lesson' ? req.params[resourceParam] : null;
        const LessonDetail = getLessonDetailModel();
        let courseId = null;

        if (resourceType === 'course') {
            courseId = req.params[resourceParam];
        } else if (resourceType === 'assignment') {
            const assignment = await getAssignmentModel()
                .findOne({ _id: req.params[resourceParam], IsDeleted: false })
                .select('CourseID LessonID');
            if (!assignment) {
                return res.status(404).json({ success: false, message: 'Assignment not found' });
            }
            courseId = assignment.CourseID;
            lessonId = assignment.LessonID;
            if (!courseId && lessonId) {
                const lesson = await getLessonModel().findById(lessonId).select('CourseID');
                courseId = lesson?.CourseID;
            }
        } else if (resourceType === 'detail') {
            const detail = await LessonDetail.findById(req.params[resourceParam]).select('LessonID');
            if (!detail) {
                return res.status(404).json({ success: false, message: 'Lesson content not found' });
            }
            lessonId = detail.LessonID;
        }

        if (resourceType === 'lesson') {
            const lesson = await getLessonModel().findById(lessonId).select('CourseID');
            if (!lesson) {
                return res.status(404).json({ success: false, message: 'Lesson not found' });
            }
            courseId = lesson.CourseID;
        } else if (resourceType === 'detail') {
            const lesson = await getLessonModel().findById(lessonId).select('CourseID');
            if (!lesson) {
                return res.status(404).json({ success: false, message: 'Lesson not found' });
            }
        }
        req.courseId = courseId;
        if (!req.courseId) {
            return res.status(404).json({ success: false, message: 'Course not found' });
        }

        if (req.user.role !== 'user') {
            return res.status(403).json({ success: false, message: 'Course access denied' });
        }

        if (!(await orderService.hasCourseAccess(req.courseId, req.user.userId))) {
            return res.status(403).json({
                success: false,
                message: 'A successful course payment is required to access lessons'
            });
        }
        return next();
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { requirePaidCourse };
