const mongoose = require('mongoose');
const { getDB_LMS } = require('../../config/db_Account');

const schema = new mongoose.Schema({
    Name: { type: String, required: true, trim: true, maxlength: 120 },
    Description: { type: String, trim: true, maxlength: 500, default: '' },
    IsActive: { type: Boolean, default: true },
    IsDeleted: { type: Boolean, default: false },
    CreatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' }
}, { timestamps: true });

schema.index({ Name: 1, IsDeleted: 1 }, { unique: true });

module.exports = () => {
    const db = getDB_LMS();
    return db.models.VocabularyTopic || db.model('VocabularyTopic', schema);
};
