const mongoose = require('mongoose');
const { getDB_LMS } = require('../../config/db_Account');

const schema = new mongoose.Schema({
    UserID: { type: mongoose.Schema.Types.ObjectId, required: true },
    WordID: { type: mongoose.Schema.Types.ObjectId, ref: 'VocabularyWord', required: true },
    Note: { type: String, trim: true, maxlength: 1000, default: '' },
    IsLearned: { type: Boolean, default: false }
}, { timestamps: true });

schema.index({ UserID: 1, WordID: 1 }, { unique: true });

module.exports = () => {
    const db = getDB_LMS();
    return db.models.SavedVocabulary || db.model('SavedVocabulary', schema);
};
