const mongoose = require('mongoose');
const getTopicModel = require('./vocabulary_topic.model');
const getWordModel = require('./vocabulary_word.model');
const getSavedModel = require('./saved_vocabulary.model');
const { mapWithConcurrency } = require('./vocabulary.lookup');
const dictionaryService = require('./dictionary.service');

const clean = (value, max = 1000) => String(value ?? '').trim().slice(0, max);
const id = value => String(value || '');
const normalizeWordKey = value => String(value || '').trim().toLocaleLowerCase('en').replace(/\s+/g, ' ');
const uniqueIdStrings = values => [...new Set((values || []).map(id).filter(Boolean))];
const senseKey = sense => [
    String(sense?.PartOfSpeech || '').trim().toLocaleLowerCase('en'),
    String(sense?.Meaning || '').trim().toLocaleLowerCase('en'),
    String(sense?.Translation || '').trim().toLocaleLowerCase('vi')
].join('|');
const assertText = (value, field) => {
    const result = clean(value);
    if (!result) throw new Error(`${field} is required`);
    return result;
};
const normalizeTopic = body => ({
    Name: assertText(body.Name, 'Topic name'),
    Description: clean(body.Description, 500),
    IsActive: body.IsActive !== false
});
const normalizeWord = body => {
    const rawSenses = Array.isArray(body.Senses) && body.Senses.length
        ? body.Senses
        : [{
            PartOfSpeech: body.PartOfSpeech,
            Meaning: body.Meaning,
            Translation: body.Translation,
            Example: body.Example,
            ExampleTranslation: body.ExampleTranslation
        }];
    if (rawSenses.length > 40) throw new Error('A word can have at most 40 senses');
    const senses = rawSenses.map(sense => ({
        PartOfSpeech: clean(sense.PartOfSpeech, 80),
        Meaning: clean(sense.Meaning, 1000),
        Translation: clean(sense.Translation, 1000),
        Example: clean(sense.Example, 1000),
        ExampleTranslation: clean(sense.ExampleTranslation, 1000)
    }));
    if (senses.some(sense => !sense.Meaning)) throw new Error('Every sense must include an English definition');
    const firstSense = senses[0];
    return {
        TopicID: assertText(body.TopicID, 'Topic'),
        TopicIDs: uniqueIdStrings([body.TopicID, ...(Array.isArray(body.TopicIDs) ? body.TopicIDs : [])]),
        Word: assertText(body.Word, 'Word'),
        NormalizedWord: normalizeWordKey(body.Word),
        Meaning: firstSense.Meaning,
        Translation: firstSense.Translation,
        PartOfSpeech: firstSense.PartOfSpeech,
        Example: firstSense.Example,
        ExampleTranslation: firstSense.ExampleTranslation,
        Senses: senses,
        Pronunciation: clean(body.Pronunciation, 120),
        Level: clean(body.Level, 40),
        IsActive: body.IsActive !== false
    };
};

const listTopics = async ({ includeInactive = false } = {}) => {
    const Topic = getTopicModel();
    const Word = getWordModel();
    const filter = { IsDeleted: false };
    if (!includeInactive) filter.IsActive = true;
    const topics = await Topic.find(filter).sort({ Name: 1 }).lean();
    if (!topics.length) return topics;
    const counts = await Word.aggregate([
        { $match: { IsDeleted: false, TopicID: { $in: topics.map(topic => topic._id) } } },
        {
            $group: {
                _id: '$TopicID',
                WordCount: { $sum: 1 },
                ActiveWordCount: { $sum: { $cond: ['$IsActive', 1, 0] } }
            }
        }
    ]);
    const countByTopic = new Map(counts.map(item => [id(item._id), item]));
    return topics.map(topic => ({
        ...topic,
        WordCount: countByTopic.get(id(topic._id))?.WordCount || 0,
        ActiveWordCount: countByTopic.get(id(topic._id))?.ActiveWordCount || 0
    }));
};

const listWords = async ({ topicId, search = '', includeInactive = false, status = '', page, limit = 50 } = {}) => {
    const Word = getWordModel();
    const Topic = getTopicModel();
    const filter = { IsDeleted: false };
    const topicFilter = { IsDeleted: false };
    if (!includeInactive) topicFilter.IsActive = true;
    if (topicId) {
        if (!mongoose.Types.ObjectId.isValid(topicId)) {
            const error = new Error('Invalid topic');
            error.statusCode = 400;
            throw error;
        }
        const topic = await Topic.findOne({ ...topicFilter, _id: topicId }).select('_id').lean();
        if (!topic) return page === undefined ? [] : { items: [], page: 1, limit: 50, total: 0, pages: 1 };
        filter.$or = [
            { TopicID: topic._id },
            { TopicIDs: topic._id }
        ];
    } else if (!includeInactive) {
        const activeTopics = await Topic.find(topicFilter).select('_id').lean();
        filter.TopicID = { $in: activeTopics.map(topic => topic._id) };
    } else {
        const visibleTopics = await Topic.find({ IsDeleted: false }).select('_id').lean();
        filter.TopicID = { $in: visibleTopics.map(topic => topic._id) };
    }
    if (!includeInactive) filter.IsActive = true;
    if (status === 'active') filter.IsActive = true;
    if (status === 'inactive') filter.IsActive = false;
    const value = clean(search, 100);
    if (value) {
        const expression = new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        filter.$or = [
            { Word: expression },
            { Translation: expression },
            { Meaning: expression },
            { 'Senses.Meaning': expression },
            { 'Senses.Translation': expression }
        ];
    }
    const query = Word.find(filter).populate('TopicID', 'Name').sort({ Word: 1 });
    if (page === undefined) return query.lean();

    const currentPage = Math.max(1, Number.parseInt(page, 10) || 1);
    const pageSize = Math.min(50, Math.max(1, Number.parseInt(limit, 10) || 50));
    const [total, items] = await Promise.all([
        Word.countDocuments(filter),
        query.skip((currentPage - 1) * pageSize).limit(pageSize).lean()
    ]);
    return {
        items,
        page: currentPage,
        limit: pageSize,
        total,
        pages: Math.max(1, Math.ceil(total / pageSize))
    };
};

const getAdminSummary = async () => {
    const Topic = getTopicModel();
    const Word = getWordModel();
    const [activeTopics, inactiveTopics, totalWords, activeWords] = await Promise.all([
        Topic.countDocuments({ IsDeleted: false, IsActive: true }),
        Topic.countDocuments({ IsDeleted: false, IsActive: false }),
        Word.countDocuments({ IsDeleted: false }),
        Word.countDocuments({ IsDeleted: false, IsActive: true })
    ]);
    return {
        activeTopics,
        inactiveTopics,
        totalWords,
        activeWords,
        inactiveWords: totalWords - activeWords
    };
};

const createTopic = async (body, userId) => {
    const Topic = getTopicModel();
    return Topic.create({ ...normalizeTopic(body), CreatedBy: userId });
};
const updateTopic = async (topicId, body) => {
    const Topic = getTopicModel();
    const topic = await Topic.findOneAndUpdate({ _id: topicId, IsDeleted: false }, normalizeTopic(body), { new: true, runValidators: true });
    if (!topic) throw new Error('Topic not found');
    return topic;
};
const deleteTopic = async topicId => {
    const Topic = getTopicModel();
    const topic = await Topic.findOneAndUpdate({ _id: topicId, IsDeleted: false }, { IsDeleted: true }, { new: true });
    if (!topic) throw new Error('Topic not found');
    return topic;
};
const createWord = async body => {
    const Topic = getTopicModel();
    const Word = getWordModel();
    const data = normalizeWord(body);
    if (!await Topic.exists({ _id: data.TopicID, IsDeleted: false })) throw new Error('Topic not found');
    const existing = await Word.findOne({
        $or: [
            { NormalizedWord: data.NormalizedWord, IsDeleted: false },
            { Word: new RegExp(`^${data.NormalizedWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), IsDeleted: false }
        ]
    });
    if (!existing) return Word.create(data);
    const topicIds = uniqueIdStrings([...(existing.TopicIDs || []), ...(existing.TopicID ? [existing.TopicID] : []), data.TopicID]);
    const senseMap = new Map();
    for (const sense of [...(existing.Senses || []), ...(data.Senses || [])]) {
        const key = senseKey(sense);
        if (key && !senseMap.has(key)) senseMap.set(key, sense);
    }
    const mergedSenses = [...senseMap.values()];
    const firstSense = mergedSenses[0] || data.Senses[0];
    existing.TopicID = data.TopicID;
    existing.TopicIDs = topicIds;
    existing.Senses = mergedSenses;
    existing.Meaning = firstSense.Meaning;
    existing.Translation = firstSense.Translation;
    existing.PartOfSpeech = firstSense.PartOfSpeech;
    existing.Example = firstSense.Example;
    existing.ExampleTranslation = firstSense.ExampleTranslation;
    existing.Pronunciation = data.Pronunciation || existing.Pronunciation;
    existing.Level = data.Level || existing.Level;
    existing.IsActive = data.IsActive;
    await existing.save();
    return existing;
};
const updateWord = async (wordId, body) => {
    const Topic = getTopicModel();
    const Word = getWordModel();
    const data = normalizeWord(body);
    if (!await Topic.exists({ _id: data.TopicID, IsDeleted: false })) throw new Error('Topic not found');
    data.TopicIDs = uniqueIdStrings([...(data.TopicIDs || []), data.TopicID]);
    const word = await Word.findOneAndUpdate({ _id: wordId, IsDeleted: false }, data, { new: true, runValidators: true });
    if (!word) throw new Error('Vocabulary word not found');
    return word;
};
const deleteWord = async wordId => {
    const Word = getWordModel();
    const word = await Word.findOneAndUpdate({ _id: wordId, IsDeleted: false }, { IsDeleted: true }, { new: true });
    if (!word) throw new Error('Vocabulary word not found');
    return word;
};

const listSaved = async userId => {
    const Saved = getSavedModel();
    const items = await Saved.find({ UserID: userId }).populate({ path: 'WordID', populate: { path: 'TopicID', select: 'Name' } }).sort({ createdAt: -1 }).lean();
    return items.filter(item => item.WordID && item.WordID.IsDeleted !== true && item.WordID.IsActive !== false);
};
const saveWord = async (userId, wordId, note = '') => {
    const Word = getWordModel();
    const Saved = getSavedModel();
    if (!await Word.exists({ _id: wordId, IsDeleted: false, IsActive: true })) throw new Error('Vocabulary word not found');
    return Saved.findOneAndUpdate({ UserID: userId, WordID: wordId }, { $set: { Note: clean(note) } }, { upsert: true, new: true, setDefaultsOnInsert: true }).populate({ path: 'WordID', populate: { path: 'TopicID', select: 'Name' } });
};
const saveExternalWord = async (userId, word) => {
    const Topic = getTopicModel();
    const Word = getWordModel();
    const data = await dictionaryService.lookupWord(word);
    const topic = await Topic.findOneAndUpdate(
        { Name: 'External dictionary', IsDeleted: false },
        { $setOnInsert: { Name: 'External dictionary', Description: 'Words saved from the external dictionary.', CreatedBy: userId, IsActive: true, IsDeleted: false } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const escapedWord = data.Word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existing = await Word.findOne({
        $or: [
            { NormalizedWord: data.Word.toLocaleLowerCase('en'), IsDeleted: false },
            { Word: new RegExp(`^${escapedWord}$`, 'i'), IsDeleted: false }
        ]
    });
    let savedWord = existing;
    if (existing) {
        existing.TopicIDs = uniqueIdStrings([...(existing.TopicIDs || []), ...(existing.TopicID ? [existing.TopicID] : []), topic._id]);
        await existing.save();
    } else {
        savedWord = await Word.create({
            ...data,
            TopicID: topic._id,
            TopicIDs: [topic._id],
            NormalizedWord: data.Word.toLocaleLowerCase('en'),
            IsDeleted: false
        });
    }
    return saveWord(userId, savedWord._id);
};
const updateSaved = async (userId, wordId, body) => {
    const Saved = getSavedModel();
    const update = {};
    if (Object.prototype.hasOwnProperty.call(body, 'Note')) update.Note = clean(body.Note, 1000);
    if (Object.prototype.hasOwnProperty.call(body, 'IsLearned')) {
        if (typeof body.IsLearned !== 'boolean') throw new Error('Learned status must be true or false');
        update.IsLearned = body.IsLearned;
    }
    if (!Object.keys(update).length) throw new Error('Provide a note or learned status');
    const saved = await Saved.findOneAndUpdate(
        { UserID: userId, WordID: wordId },
        { $set: update },
        { new: true }
    ).populate({ path: 'WordID', populate: { path: 'TopicID', select: 'Name' } });
    if (!saved) throw new Error('Saved word not found');
    return saved;
};
const removeSaved = async (userId, wordId) => {
    const Saved = getSavedModel();
    const result = await Saved.findOneAndDelete({ UserID: userId, WordID: wordId });
    if (!result) throw new Error('Saved word not found');
    return result;
};

const translate = async ({ word, context = '' }) => {
    const dictionary = await dictionaryService.lookupWord(word);
    return {
        translation: dictionary.Translation,
        meaning: dictionary.Meaning,
        partOfSpeech: dictionary.PartOfSpeech,
        example: dictionary.Example,
        exampleTranslation: dictionary.ExampleTranslation,
        senses: dictionary.Senses,
        context
    };
};

const bulkImport = async (topicId, values) => {
    const Topic = getTopicModel();
    const Word = getWordModel();
    if (!await Topic.exists({ _id: topicId, IsDeleted: false })) throw new Error('Topic not found');
    const words = [...new Set(String(values || '').split(/[\n,;]+/).map(value => value.trim().toLowerCase()).filter(Boolean))];
    if (!words.length) throw new Error('Enter at least one word');
    if (words.length > 50) throw new Error('Import is limited to 50 words at a time');
    const result = { imported: [], skipped: [], failed: [] };
    await mapWithConcurrency(words, 2, async word => {
        try {
            const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const existing = await Word.findOne({
                $or: [
                    { NormalizedWord: word, IsDeleted: false },
                    { Word: new RegExp(`^${escapedWord}$`, 'i'), IsDeleted: false }
                ]
            }).select('_id TopicIDs TopicID').lean();
            if (existing) {
                await Word.updateOne(
                    { _id: existing._id },
                    { $addToSet: { TopicIDs: topicId } }
                );
                result.skipped.push({ word, message: 'Already exists in Vocabulary Master; linked to this topic.' });
                return;
            }
            const data = await dictionaryService.lookupWord(word);
            if (data.Senses.some(sense => !sense.Translation)) {
                result.failed.push({
                    word,
                    message: 'At least one sense has no Vietnamese translation; add it manually before importing.'
                });
                return;
            }
            const saved = await Word.findOneAndUpdate(
                { TopicID: topicId, Word: data.Word, IsDeleted: false },
                { ...data, TopicID: topicId, IsDeleted: false },
                { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
            );
            result.imported.push(saved);
        } catch (error) {
            result.failed.push({ word, message: clean(error.message || 'Lookup failed', 300) });
        }
    });
    return result;
};

module.exports = {
    listTopics,
    listWords,
    getAdminSummary,
    createTopic,
    updateTopic,
    deleteTopic,
    createWord,
    updateWord,
    deleteWord,
    listSaved,
    saveWord,
    saveExternalWord,
    updateSaved,
    removeSaved,
    translate,
    lookupWord: dictionaryService.lookupWord,
    bulkImport
};
