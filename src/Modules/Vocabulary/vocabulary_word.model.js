const mongoose = require('mongoose');
const { getDB_LMS } = require('../../config/db_Account');

const schema = new mongoose.Schema({
    TopicID: { type: mongoose.Schema.Types.ObjectId, ref: 'VocabularyTopic', required: true },
    TopicIDs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'VocabularyTopic' }],
    Word: { type: String, required: true, trim: true, maxlength: 120 },
    NormalizedWord: { type: String, trim: true, maxlength: 120, default: '' },
    Meaning: { type: String, required: true, trim: true, maxlength: 1000 },
    Translation: { type: String, trim: true, maxlength: 1000, default: '' },
    PartOfSpeech: { type: String, trim: true, maxlength: 80, default: '' },
    Example: { type: String, trim: true, maxlength: 1000, default: '' },
    ExampleTranslation: { type: String, trim: true, maxlength: 1000, default: '' },
    Senses: [{
        PartOfSpeech: { type: String, trim: true, maxlength: 80, default: '' },
        Meaning: { type: String, trim: true, maxlength: 1000, default: '' },
        Translation: { type: String, trim: true, maxlength: 1000, default: '' },
        Example: { type: String, trim: true, maxlength: 1000, default: '' },
        ExampleTranslation: { type: String, trim: true, maxlength: 1000, default: '' }
    }],
    Pronunciation: { type: String, trim: true, maxlength: 120, default: '' },
    IPAUK: { type: String, trim: true, maxlength: 120, default: '' },
    IPAUS: { type: String, trim: true, maxlength: 120, default: '' },
    AudioUK: { type: String, trim: true, maxlength: 500, default: '' },
    AudioUS: { type: String, trim: true, maxlength: 500, default: '' },
    Level: { type: String, trim: true, maxlength: 40, default: '' },
    Source: {
        Provider: { type: String, trim: true, maxlength: 100, default: '' },
        URL: { type: String, trim: true, maxlength: 500, default: '' },
        License: { type: String, trim: true, maxlength: 200, default: '' },
        Attribution: { type: String, trim: true, maxlength: 500, default: '' }
    },
    DictionaryStatus: { type: String, enum: ['verified', 'partial', 'manual'], default: 'partial' },
    IsActive: { type: Boolean, default: true },
    IsDeleted: { type: Boolean, default: false }
}, { timestamps: true });

schema.index({ TopicID: 1, Word: 1, IsDeleted: 1 }, { unique: true });
schema.index({ NormalizedWord: 1, IsDeleted: 1 });
schema.index({ TopicIDs: 1, IsDeleted: 1 });

module.exports = () => {
    const db = getDB_LMS();
    return db.models.VocabularyWord || db.model('VocabularyWord', schema);
};
