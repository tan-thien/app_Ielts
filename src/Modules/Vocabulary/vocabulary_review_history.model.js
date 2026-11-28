const mongoose = require('mongoose');
const { getDB_LMS } = require('../../config/db_Account');

const schema = new mongoose.Schema({
    UserID: { type: mongoose.Schema.Types.ObjectId, required: true },
    WordID: { type: mongoose.Schema.Types.ObjectId, ref: 'VocabularyWord', required: true },
    RequestID: { type: String, required: true, trim: true, maxlength: 80 },
    Rating: { type: String, enum: ['again', 'hard', 'good', 'easy'], required: true },
    IntervalDays: { type: Number, min: 0, required: true },
    NextReviewAt: { type: Date, required: true },
    ReviewedAt: { type: Date, default: Date.now, required: true }
}, { timestamps: true });

schema.index({ UserID: 1, RequestID: 1 }, { unique: true });
schema.index({ UserID: 1, ReviewedAt: -1 });

module.exports = () => {
    const db = getDB_LMS();
    return db.models.VocabularyReviewHistory || db.model('VocabularyReviewHistory', schema);
};
