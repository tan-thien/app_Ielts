const mongoose = require('mongoose');
const { getDB_LMS } = require('../../config/db_Account');

const schema = new mongoose.Schema({
    UserID: { type: mongoose.Schema.Types.ObjectId, required: true },
    Name: { type: String, required: true, trim: true, maxlength: 120 },
    NormalizedName: { type: String, required: true, trim: true, maxlength: 120 },
    Description: { type: String, trim: true, maxlength: 500, default: '' },
    WordIDs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'VocabularyWord', required: true }]
}, { timestamps: true });

schema.index({ UserID: 1, NormalizedName: 1 }, { unique: true });
schema.index({ UserID: 1, updatedAt: -1 });

module.exports = () => {
    const db = getDB_LMS();
    return db.models.VocabularyFlashcardSet || db.model('VocabularyFlashcardSet', schema);
};
