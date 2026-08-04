const mongoose = require('mongoose');
const { getDB_LMS } = require('../../../config/db_Account');

const lessonDetailSchema = new mongoose.Schema({
    LessonID: { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson', required: true },
    Title: { type: String, required: true },
    Content: { type: String, default: "" },
    Type: {
        type: String,
        enum: ["Text", "Video", "Audio", "PDF", "Image", "Quiz"],
        required: true
    },
    FileUrl: { type: String, default: "" },
    Thumbnail: { type: String, default: "" },
    Oder: { type: Number, default: 1 },
    Duration: { type: Number, default: 0 }, // Duration in seconds
    Status: { type: Boolean, default: true },
},
    { timestamps: true });

module.exports = () => { return getDB_LMS().model('LessonDetail', lessonDetailSchema); };