const mongoose = require('mongoose');
const { getDB_LMS } = require('../../config/db_Account');

const reviewHistorySchema = new mongoose.Schema({
    ReviewedAt: { type: Date, required: true, default: Date.now },
    WasCorrect: { type: Boolean, default: undefined },
    Status: { type: String, enum: ['New', 'Reviewing', 'Learning', 'Mastered'], required: true },
    Note: { type: String, default: '', maxlength: 1000 },
    NextReviewAt: { type: Date, default: null }
}, { _id: false });

const mistakeSchema = new mongoose.Schema({
    OwnerID: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    SourceKey: { type: String, required: true },
    SourceType: { type: String, enum: ['Assignment', 'AI'], required: true },
    SourceSubmissionID: { type: mongoose.Schema.Types.ObjectId, ref: 'Submission', required: true },
    AssignmentID: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment', default: null },
    Skill: { type: String, enum: ['Reading', 'Listening', 'Writing', 'Speaking'], required: true },
    QuestionOrder: { type: Number, default: null },
    AIErrorIndex: { type: Number, default: null },
    SourceTitle: { type: String, default: '' },
    Question: { type: String, default: '' },
    OriginalAnswer: { type: mongoose.Schema.Types.Mixed, default: null },
    CorrectAnswer: { type: mongoose.Schema.Types.Mixed, default: null },
    ErrorType: { type: String, default: '' },
    ErrorQuote: { type: String, default: '' },
    Explanation: { type: String, default: '' },
    Suggestion: { type: String, default: '' },
    Note: { type: String, default: '', maxlength: 2000 },
    Status: { type: String, enum: ['New', 'Reviewing', 'Learning', 'Mastered'], default: 'New' },
    NextReviewAt: { type: Date, default: null },
    LastReviewedAt: { type: Date, default: null },
    ReviewCount: { type: Number, default: 0, min: 0 },
    CorrectReviewCount: { type: Number, default: 0, min: 0 },
    ReviewHistory: { type: [reviewHistorySchema], default: [] }
}, { timestamps: true });

mistakeSchema.index({ OwnerID: 1, SourceKey: 1 }, { unique: true });
mistakeSchema.index({ OwnerID: 1, Status: 1, NextReviewAt: 1, createdAt: -1 });

module.exports = () => {
    const db = getDB_LMS();
    return db.models.MistakeNotebookEntry || db.model('MistakeNotebookEntry', mistakeSchema);
};
