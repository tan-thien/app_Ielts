const { get } = require('mongoose');
const getLessonModel = require('../lesson/lesson.model');
const getLessonDetailModel = require('../lesson/lesson_detail.model');
const getCourseModel = require('../Course/Course.model');
const getUserModel = require('../../auth/Account.model');

const createLesson = async (data) => {
    const Lesson = getLessonModel();
    const LessonDetail = getLessonDetailModel();

    // for (const field of requiredFields) {
    //     if (data[field] === undefined || data[field] === null) {
    //         throw new Error(`${field} is required`);
    //     }
    // }

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
            Type: item.Type,
            Content: item.Content ?? "",
            FileUrl: item.FileUrl ?? "",
            Status: item.Status ?? true,
            Order: index + 1
        }));

        await LessonDetail.insertMany(details);

    }
    return lesson;
};

const getLessonById = async (id) => {
    const Lesson = getLessonModel();
    const LessonDetail = getLessonDetailModel();
    const lesson = await Lesson.findById(id).populate({ path: 'CourseID', model: getCourseModel() }).populate({ path: 'UserCreate', model: getUserModel() });
    if (!lesson) {
        throw new Error('Lesson not found');
    }
    const details = await LessonDetail.find({ LessonID: id }).sort({ Order: 1 });
    lesson.Details = details;
    return { Lesson: lesson, Details: details };
};

const getAllLessons = async () => {
    const Lesson = getLessonModel();
    const lessons = await Lesson.find().populate({ path: 'CourseID', model: getCourseModel() }).populate({ path: 'UserCreate', model: getUserModel() });
    return lessons;
}
const getLessonByCourseId = async (courseId) => {
    const Lesson = getLessonModel();
    const lessons = await Lesson.find({ CourseID: courseId }).populate({ path: 'CourseID', model: getCourseModel() }).populate({ path: 'UserCreate', model: getUserModel() });
    return lessons;
}

const updateLesson = async (id, data) => {
    const Lesson = getLessonModel();
    const LessonDetail = getLessonDetailModel();

    const lesson = await Lesson.findByIdAndUpdate(id,
        {
            Name: data.Name,
            Description: data.Description,
            Time: data.Time,
            Unit: data.Unit,
            CourseID: data.CourseID,
            Status: data.Status,
            IsOpen: data.IsOpen,
            IsDeleted: data.IsDeleted
        },
        { new: true }
    );

    if (!lesson) {
        throw new Error("Lesson not found");
    }

    await LessonDetail.deleteMany({ LessonID: id });

    const details = data.Details || [];
    for (const detail of details) {
        await LessonDetail.create({
            LessonID: id,
            Content: detail.Content,
            Type: detail.Type,
            FileUrl: detail.FileUrl,
            Status: detail.Status ?? true,
            Order: index + 1
        });
    }

    return lesson;
};

const deleteLesson = async (id) => {
    const Lesson = getLessonModel();
    const LessonDetail = getLessonDetailModel();

    // Kiểm tra Lesson trước
    const lesson = await Lesson.findById(id);

    if (!lesson) {
        throw new Error("Lesson not found");
    }

    // Xóa tất cả LessonDetail thuộc Lesson
    await LessonDetail.deleteMany({
        LessonID: id
    });

    // Xóa Lesson
    await Lesson.findByIdAndDelete(id);

    return lesson;
};

module.exports = {
    createLesson,
    getLessonById,
    getAllLessons,
    getLessonByCourseId,
    updateLesson,
    deleteLesson
};


module.exports = { createLesson, getLessonById, getAllLessons, getLessonByCourseId, updateLesson, deleteLesson };
