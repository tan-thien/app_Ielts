const getLessonDetailModel = require("./lesson_detail.model");

const createDetail = async (data) => {

    const LessonDetail = getLessonDetailModel();
    const lastDetail = await LessonDetail.findOne({ LessonID: data.LessonID }).sort({ Order: -1 });
    const newOrder = lastDetail ? lastDetail.Order + 1 : 1;
    return await LessonDetail.create({
        LessonID: data.LessonID,
        Content: data.Content,
        Type: data.Type,
        FileUrl: data.FileUrl,
        Status: data.Status,
        Order: newOrder
    });

};

const getDetailById = async (id) => {

    const LessonDetail = getLessonDetailModel();

    return await LessonDetail.findById(id);

};

const getByLesson = async (lessonId) => {

    const LessonDetail = getLessonDetailModel();
    return await LessonDetail.find({ LessonID: lessonId }).sort({ Order: 1 });

};

const updateDetail = async (id, data) => {

    const LessonDetail = getLessonDetailModel();
    return await LessonDetail.findByIdAndUpdate( id, data, { new: true } );

};

const deleteDetail = async (id) => {

    const LessonDetail = getLessonDetailModel();

    const detail = await LessonDetail.findById(id);

    if (!detail) {
        throw new Error("Lesson detail not found");
    }

    const lessonId = detail.LessonID;
    const deletedOrder = detail.Order;

    // Delete
    await LessonDetail.findByIdAndDelete(id);

    // Re-order remaining details
    await LessonDetail.updateMany(
        {
            LessonID: lessonId,
            Order: {
                $gt: deletedOrder
            }
        },
        {
            $inc: {
                Order: -1
            }
        }
    );

    return await LessonDetail
        .find({
            LessonID: lessonId
        })
        .sort({
            Order: 1
        });
};


module.exports = {
    createDetail,
    getDetailById,
    getByLesson,
    updateDetail,
    deleteDetail
};