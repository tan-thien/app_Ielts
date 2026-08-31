const mongoose = require('mongoose');
const { getDB_LMS } = require('../../../config/db_Account');

const lessonDetailSchema = new mongoose.Schema({
    LessonID: { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson', required: true },

    Content: { type: String, default: "" },
    Type: {
        type: String,
        enum: ["Text", "Video", "Audio", "PDF", "Image", "Quiz"],
        required: true
    },
    FileUrl: { type: String, default: "" },
    Status: { type: Boolean, default: true },
},
    { timestamps: true });

module.exports = () => { return getDB_LMS().model('LessonDetail', lessonDetailSchema); };