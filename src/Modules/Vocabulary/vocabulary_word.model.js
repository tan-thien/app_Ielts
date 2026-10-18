const mongoose = require('mongoose');
const { getDB_LMS } = require('../../config/db_Account');

const schema = new mongoose.Schema({
    TopicID: { type: mongoose.Schema.Types.ObjectId, ref: 'VocabularyTopic', required: true },
    Word: { type: String, required: true, trim: true, maxlength: 120 },
    Meaning: { type: String, required: true, trim: true, maxlength: 1000 },
    Translation: { type: String, required: true, trim: true, maxlength: 1000 },
    PartOfSpeech: { type: String, trim: true, maxlength: 80, default: '' },
    Example: { type: String, required: true, trim: true, maxlength: 1000 },
    ExampleTranslation: { type: String, trim: true, maxlength: 1000, default: '' },
    Senses: [{
        PartOfSpeech: { type: String, trim: true, maxlength: 80, default: '' },
        Meaning: { type: String, trim: true, maxlength: 1000, default: '' },
        Translation: { type: String, trim: true, maxlength: 1000, default: '' },
        Example: { type: String, trim: true, maxlength: 1000, default: '' },
        ExampleTranslation: { type: String, trim: true, maxlength: 1000, default: '' }
    }],
    Pronunciation: { type: String, trim: true, maxlength: 120, default: '' },
    Level: { type: String, trim: true, maxlength: 40, default: '' },
    IsActive: { type: Boolean, default: true },
    IsDeleted: { type: Boolean, default: false }
}, { timestamps: true });

schema.index({ TopicID: 1, Word: 1, IsDeleted: 1 }, { unique: true });

module.exports = () => {
    const db = getDB_LMS();
    return db.models.VocabularyWord || db.model('VocabularyWord', schema);
};
