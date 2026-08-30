const getLessonDetailModel = require("./lesson_detail.model");

const createDetail = async (data) => {

    const LessonDetail = getLessonDetailModel();

    return await LessonDetail.create({
        LessonID: data.LessonID,
        Content: data.Content,
        Type: data.Type,
        FileUrl: data.FileUrl,
        Status: data.Status
    });

};

const getDetailById = async (id) => {

    const LessonDetail = getLessonDetailModel();

    return await LessonDetail.findById(id);

};

const getByLesson = async (lessonId) => {

    const LessonDetail = getLessonDetailModel();

    return await LessonDetail
        .find({ LessonID: lessonId })
        .sort({ Order: 1 });

};

const updateDetail = async (id, data) => {

    const LessonDetail = getLessonDetailModel();

    return await LessonDetail.findByIdAndUpdate(
        id,
        data,
        { new: true }
    );

};

const deleteDetail = async (id) => {

    const LessonDetail = getLessonDetailModel();

    return await LessonDetail.findByIdAndDelete(id);

};

module.exports = {
    createDetail,
    getDetailById,
    getByLesson,
    updateDetail,
    deleteDetail
};