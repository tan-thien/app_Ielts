const mongoose = require('mongoose');
const { connectDB_LMS, closeDB, getDB_LMS } = require('../src/config/db_Account');
require('dotenv').config();
require('../src/Modules/Vocabulary/vocabulary_word.model')();
require('../src/Modules/Vocabulary/saved_vocabulary.model')();
require('../src/Modules/Vocabulary/vocabulary_review.model')();
require('../src/Modules/Vocabulary/vocabulary_review_history.model')();

const apply = process.argv.includes('--apply');
const cleanWord = value => String(value || '').trim().toLocaleLowerCase('en').replace(/\s+/g, ' ');

async function main() {
    await connectDB_LMS();
    const db = getDB_LMS();
    const Word = db.models.VocabularyWord;
    if (!Word) throw new Error('VocabularyWord model is not registered');
    const words = await Word.find({ IsDeleted: false }).lean();
    const groups = new Map();
    for (const word of words) {
        const key = cleanWord(word.NormalizedWord || word.Word);
        if (!key) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(word);
    }

    const report = { groups: 0, duplicateWords: 0, sensesAdded: 0, topicLinksAdded: 0, conflicts: [], refsRewritten: 0 };
    for (const [key, group] of groups) {
        if (group.length < 2) continue;
        report.groups += 1;
        report.duplicateWords += group.length - 1;
        const master = [...group].sort((a, b) => String(a._id).localeCompare(String(b._id)))[0];
        const topicIds = new Set([
            ...(master.TopicIDs || []).map(String),
            ...(master.TopicID ? [String(master.TopicID)] : [])
        ]);
        const senses = new Map();
        for (const word of group) {
            for (const sense of (word.Senses && word.Senses.length ? word.Senses : [{
                PartOfSpeech: word.PartOfSpeech,
                Meaning: word.Meaning,
                Translation: word.Translation,
                Example: word.Example,
                ExampleTranslation: word.ExampleTranslation
            }])) {
                const senseKey = [sense.PartOfSpeech, sense.Meaning, sense.Translation].map(value => String(value || '').trim().toLocaleLowerCase('en')).join('|');
                if (sense.Meaning && !senses.has(senseKey)) senses.set(senseKey, sense);
            }
            for (const topicId of word.TopicIDs || []) topicIds.add(String(topicId));
            if (word.TopicID) topicIds.add(String(word.TopicID));
        }
        const mergedSenses = [...senses.values()];
        report.sensesAdded += mergedSenses.length;
        report.topicLinksAdded += topicIds.size;
        if (group.some(word => word.Senses?.length && word.Senses.length !== mergedSenses.length)) {
            report.conflicts.push(key);
        }
        if (!apply) continue;

        const oldIds = group.filter(word => String(word._id) !== String(master._id)).map(word => word._id);
        const first = mergedSenses[0];
        await Word.updateOne({ _id: master._id }, {
            $set: {
                NormalizedWord: key,
                TopicID: [...topicIds][0],
                TopicIDs: [...topicIds],
                Senses: mergedSenses,
                Meaning: first?.Meaning || master.Meaning,
                Translation: first?.Translation || master.Translation,
                PartOfSpeech: first?.PartOfSpeech || master.PartOfSpeech,
                Example: first?.Example || master.Example,
                ExampleTranslation: first?.ExampleTranslation || master.ExampleTranslation
            }
        });
        for (const modelName of ['SavedVocabulary', 'VocabularyReview', 'VocabularyReviewHistory']) {
            if (!db.models[modelName]) continue;
            const model = db.models[modelName];
            const result = await model.updateMany(
                { WordID: { $in: oldIds } },
                { $set: { WordID: master._id } }
            );
            report.refsRewritten += result.modifiedCount || 0;
        }
        await Word.updateMany({ _id: { $in: oldIds } }, { $set: { IsDeleted: true } });
    }
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...report }, null, 2));
}

main()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await closeDB().catch(() => {});
    });
