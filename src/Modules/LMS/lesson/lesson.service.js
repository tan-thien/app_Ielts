const { get } = require('mongoose');
const getLessonModel = require('../lesson/lesson.model');
const getLessonDetailModel = require('../lesson/lesson_detail.model');
const getCourseModel = require('../Course/Course.model');
const getUserModel = require('../../auth/Account.model');
const { authorize } = require('../../../middlewares/authorize.middleware');

const createLesson = async (data) => {
    const Lesson = getLessonModel();


    for (const field of requiredFields) {
        if (data[field] === undefined || data[field] === null) {
            throw new Error(`${field} is required`);
        }
    }

    const lesson = await Lesson.create({
        Name: data.Name,
        Description: data.Description,
        Time: data.Time,
        Unit: data.Unit,
        CourseID: data.CourseID,
        UserCreate: data.UserCreate,
        Status: data.Status ?? 'Draft',
        IsOpen: data.IsOpen ?? false
    });
    if (Array.isArray(data.Details)) {

        const details = data.Details.map((item, index) => ({
            LessonID: lesson._id,
            Title: item.Title,
            Type: item.Type,
            Content: item.Content ?? "",
            FileUrl: item.FileUrl ?? "",
            Thumbnail: item.Thumbnail ?? "",
            Duration: item.Duration ?? 0,
            Order: item.Order ?? index + 1
        }));

        await LessonDetail.insertMany(details);

    }
    return lesson;
};

const getLessonById = async (id) => {
    const Lesson = getLessonModel();
    const lesson = await Lesson.findById(id).populate('CourseID').populate('UserCreate');
    if (!lesson) {
        throw new Error('Lesson not found');
    }   
    return lesson;
};

const getAllLessons = async () => {
    const Lesson = getLessonModel();
    const lessons = await Lesson.find().populate('CourseID').populate('UserCreate');
    return lessons;
}
const getLessonByCourseId = async (courseId) => {
    const Lesson = getLessonModel();
    const lessons = await Lesson.find({ CourseID: courseId }).populate('CourseID').populate('UserCreate');
    return lessons;
}

const updateLesson = async (id, data) => {
    const Lesson = getLessonModel();
    const LessonDetail = getLessonDetailModel();
    const lesson = await Lesson.findByIdAndUpdate(id, data, { new: true });
    if (!lesson) {
        throw new Error('Lesson not found');
    }
    const details = data.Details || [];
    for (const detail of details) {
        if (detail._id) {
            await LessonDetail.findByIdAndUpdate(detail._id, detail);
        } else {
            await LessonDetail.create({ ...detail, LessonID: lesson._id });
        }
    }
    
    return lesson;
}

module.exports = { createLesson, getLessonById, getAllLessons, getLessonByCourseId, updateLesson };
