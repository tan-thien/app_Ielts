const mongoose = require('mongoose');
const { getDB_LMS } = require('../../../config/db_Account');

const lessonSchema = new mongoose.Schema({
    Name: { type: String, required: true },
    Description: { type: String, required: true },
    Time: { type: Date, required: true },
    Unit: { type: String, required: true },
    CourseID: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    UserCreate: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    Status: {
        type: String,
        enum: ['Draft', 'Pending', 'Active', 'Finished'],
        default: 'Draft'
    },
    IsOpen: { type: Boolean, default: false },
    IsDeleted: { type: Boolean, default: false },

},
    { timestamps: true });

module.exports = () => { return getDB_LMS().model('Lesson', lessonSchema); };