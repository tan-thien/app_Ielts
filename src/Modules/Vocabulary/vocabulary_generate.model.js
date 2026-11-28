const mongoose = require('mongoose');
const { getDB_LMS } = require('../../config/db_Account');

const previewSchema = new mongoose.Schema({
    Key: { type: String, required: true },
    Word: { type: String, required: true, trim: true, maxlength: 120 },
    Preview: { type: mongoose.Schema.Types.Mixed, default: {} },
    Status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
    Error: { type: String, trim: true, maxlength: 1000, default: '' }
}, { _id: false });

const schema = new mongoose.Schema({
    UserID: { type: mongoose.Schema.Types.ObjectId, required: true },
    TopicID: { type: mongoose.Schema.Types.ObjectId, ref: 'VocabularyTopic', required: true },
    Level: { type: String, trim: true, maxlength: 40, default: '' },
    TargetCount: { type: Number, required: true, min: 1, max: 500 },
    GeneratedCount: { type: Number, default: 0, min: 0 },
    ValidCount: { type: Number, default: 0, min: 0 },
    DuplicateCount: { type: Number, default: 0, min: 0 },
    ApprovedCount: { type: Number, default: 0, min: 0 },
    BatchNumber: { type: Number, default: 0, min: 0 },
    BatchStatus: { type: String, enum: ['Idle', 'Processing', 'Completed', 'Error'], default: 'Idle' },
    ErrorMessage: { type: String, trim: true, maxlength: 1000, default: '' },
    Previews: [previewSchema]
}, { timestamps: true });

schema.index({ UserID: 1, TopicID: 1, updatedAt: -1 });

module.exports = () => {
    const db = getDB_LMS();
    return db.models.VocabularyGenerateJob || db.model('VocabularyGenerateJob', schema);
};
