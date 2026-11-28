const mongoose = require('mongoose');
const { getDB_LMS } = require('../../config/db_Account');

const schema = new mongoose.Schema({
    UserID: { type: mongoose.Schema.Types.ObjectId, required: true },
    WordID: { type: mongoose.Schema.Types.ObjectId, ref: 'VocabularyWord', required: true },
    EaseFactor: { type: Number, min: 1.3, max: 2.7, default: 2.5 },
    Repetitions: { type: Number, min: 0, default: 0 },
    TotalReviewCount: { type: Number, min: 0, default: 0 },
    CorrectCount: { type: Number, min: 0, default: 0 },
    IncorrectCount: { type: Number, min: 0, default: 0 },
    MemoryLevel: { type: Number, min: 0, max: 5, default: 0 },
    CurrentStatus: { type: String, enum: ['New', 'Learning', 'Reviewing', 'Mastered'], default: 'New' },
    IntervalDays: { type: Number, min: 0, default: 0 },
    LastReviewedAt: { type: Date, default: null },
    NextReviewAt: { type: Date, default: Date.now }
}, { timestamps: true });

schema.index({ UserID: 1, WordID: 1 }, { unique: true });
schema.index({ UserID: 1, NextReviewAt: 1 });
schema.index({ UserID: 1, CurrentStatus: 1, NextReviewAt: 1 });

module.exports = () => {
    const db = getDB_LMS();
    return db.models.VocabularyReview || db.model('VocabularyReview', schema);
};
