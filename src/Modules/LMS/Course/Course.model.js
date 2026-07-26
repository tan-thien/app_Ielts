const mongoose = require('mongoose');
const { getDB_LMS } = require('../../../config/db_Account');

const courseSchema = new mongoose.Schema({
    Name: { type: String, required: true },
    Description: {  type: String, required: true},
    Time: { type: Date, required: true },
    UserCreate: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    Fee: { type: Number, default: 0.00 },
    Thumbnail: { type: String, required: true },
    Status:{type: Boolean, default: false},
    IsOpen:{type: Boolean, default: false},
    IsDeleted:{type: Boolean, default: false},
    
});

module.exports = () => {return getDB_LMS().model('Course', courseSchema);};
