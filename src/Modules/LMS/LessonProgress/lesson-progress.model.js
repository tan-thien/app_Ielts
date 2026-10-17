const mongoose = require('mongoose');
const { getDB_LMS } = require('../../../config/db_Account');

const lessonProgressSchema = new mongoose.Schema({
    UserID: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    CourseID: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    LessonID: { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson', required: true },
    CompletedAt: { type: Date, default: Date.now }
}, { timestamps: true });

lessonProgressSchema.index({ UserID: 1, LessonID: 1 }, { unique: true });
lessonProgressSchema.index({ UserID: 1, CourseID: 1 });

module.exports = () => {
    const db = getDB_LMS();
    return db.models.LessonProgress || db.model('LessonProgress', lessonProgressSchema);
};
