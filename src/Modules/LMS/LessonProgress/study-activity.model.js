const mongoose = require('mongoose');
const { getDB_LMS } = require('../../../config/db_Account');

const schema = new mongoose.Schema({
    UserID: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    CourseID: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    StudyDate: { type: String, required: true }
}, { timestamps: true });

schema.index({ UserID: 1, CourseID: 1, StudyDate: 1 }, { unique: true });

module.exports = () => {
    const db = getDB_LMS();
    return db.models.StudyActivity || db.model('StudyActivity', schema);
};
