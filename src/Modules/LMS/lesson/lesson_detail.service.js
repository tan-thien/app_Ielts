const mongoose = require("mongoose");
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

const reorderDetails = async (lessonId, detailIds) => {

    if (!mongoose.Types.ObjectId.isValid(lessonId)) {
        throw new Error("Invalid lesson ID");
    }

    if (!Array.isArray(detailIds) || detailIds.some(id =>
        typeof id !== "string" || !mongoose.Types.ObjectId.isValid(id)
    )) {
        throw new Error("A valid list of lesson detail IDs is required");
    }

    const orderedIds = detailIds.map(id => id.toString());
    const uniqueIds = new Set(orderedIds);

    if (uniqueIds.size !== orderedIds.length) {
        throw new Error("Lesson detail IDs must be unique");
    }

    const LessonDetail = getLessonDetailModel();
    const existingDetails = await LessonDetail
        .find({ LessonID: lessonId })
        .select("_id")
        .lean();
    const existingIds = new Set(existingDetails.map(detail => detail._id.toString()));

    if (
        existingIds.size !== uniqueIds.size ||
        [...uniqueIds].some(id => !existingIds.has(id))
    ) {
        throw new Error("Submitted details must match the lesson's current details");
    }

    if (orderedIds.length > 0) {
        await LessonDetail.bulkWrite(orderedIds.map((id, index) => ({
            updateOne: {
                filter: { _id: id, LessonID: lessonId },
                update: { $set: { Order: index + 1 } }
            }
        })));
    }

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
    await LessonDetail.updateMany({ LessonID: lessonId, Order: { $gt: deletedOrder}},{$inc: { Order: -1 }});

    return await LessonDetail.find({LessonID: lessonId}).sort({Order: 1});
};


module.exports = {
    createDetail,
    getDetailById,
    getByLesson,
    reorderDetails,
    updateDetail,
    deleteDetail
};