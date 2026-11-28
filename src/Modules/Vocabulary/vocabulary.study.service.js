const mongoose = require('mongoose');
const getWordModel = require('./vocabulary_word.model');
const getSavedModel = require('./saved_vocabulary.model');
const getTopicModel = require('./vocabulary_topic.model');
const getSetModel = require('./flashcard_set.model');
const getReviewModel = require('./vocabulary_review.model');
const getHistoryModel = require('./vocabulary_review_history.model');

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const isObjectId = value => mongoose.Types.ObjectId.isValid(String(value || ''));

const normalizeWordIds = value => {
    if (!Array.isArray(value)) throw fail('WordIDs must be an array');
    if (value.length > 200) throw fail('A flashcard set can contain at most 200 words');
    const unique = [...new Set(value.map(item => String(item || '').trim()))];
    if (unique.some(item => !isObjectId(item))) throw fail('One or more vocabulary word IDs are invalid');
    return unique;
};

const pagination = (pageValue, limitValue, maxLimit = 50) => {
    const page = Math.max(1, Number.parseInt(pageValue, 10) || 1);
    const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(limitValue, 10) || 20));
    return { page, limit, skip: (page - 1) * limit };
};

const scheduleReview = (current, rating, now = new Date()) => {
    if (!['again', 'hard', 'good', 'easy'].includes(rating)) throw fail('Rating must be again, hard, good, or easy');
    const previousRepetitions = current?.Repetitions || 0;
    const previousInterval = current?.IntervalDays || 0;
    const ease = current?.EaseFactor || 2.5;
    let intervalDays;
    let easeFactor = ease;
    let repetitions = previousRepetitions;

    if (rating === 'again') {
        intervalDays = 1 / 144;
        repetitions = 0;
        easeFactor = Math.max(1.3, ease - 0.2);
    } else if (rating === 'hard') {
        intervalDays = previousInterval ? Math.max(1, Math.ceil(previousInterval * 1.2)) : 1;
        repetitions += 1;
        easeFactor = Math.max(1.3, ease - 0.15);
    } else if (rating === 'good') {
        intervalDays = previousInterval ? Math.max(1, Math.round(previousInterval * ease)) : 1;
        repetitions += 1;
    } else {
        intervalDays = previousInterval ? Math.max(4, Math.round(previousInterval * (ease + 0.3))) : 4;
        repetitions += 1;
        easeFactor = Math.min(2.7, ease + 0.15);
    }

    const reviewedAt = new Date(now);
    return {
        EaseFactor: easeFactor,
        Repetitions: repetitions,
        IntervalDays: intervalDays,
        LastReviewedAt: reviewedAt,
        NextReviewAt: new Date(reviewedAt.getTime() + intervalDays * 86400000),
        ReviewedAt: reviewedAt
    };
};

const ensureSavedWords = async (userId, wordIds) => {
    if (wordIds.length === 0) return;
    const Saved = getSavedModel();
    const Word = getWordModel();
    const [saved, active] = await Promise.all([
        Saved.find({ UserID: userId, WordID: { $in: wordIds } }).select('WordID').lean(),
        Word.find({ _id: { $in: wordIds }, IsActive: true, IsDeleted: false }).select('_id').lean()
    ]);
    const savedIds = new Set(saved.map(item => String(item.WordID)));
    const activeIds = new Set(active.map(item => String(item._id)));
    if (wordIds.some(wordId => !savedIds.has(wordId) || !activeIds.has(wordId))) {
        throw fail('Flashcard sets can only include active words saved in your vocabulary', 403);
    }
};

const normalizeSet = body => {
    const name = clean(body.Name, 120);
    if (!name) throw fail('Set name is required');
    return {
        Name: name,
        NormalizedName: name.toLowerCase(),
        Description: clean(body.Description, 500)
    };
};

const listSets = async (userId, query = {}) => {
    const Set = getSetModel();
    const { page, limit, skip } = pagination(query.page, query.limit);
    const [items, total] = await Promise.all([
        Set.find({ UserID: userId }).sort({ updatedAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
        Set.countDocuments({ UserID: userId })
    ]);
    return { items, page, limit, total, pages: Math.ceil(total / limit) };
};

const createSet = async (userId, body = {}) => {
    const Set = getSetModel();
    const wordIds = normalizeWordIds(body.WordIDs);
    if (wordIds.length === 0) throw fail('A flashcard set must contain at least one saved word');
    await ensureSavedWords(userId, wordIds);
    try {
        return await Set.create({ UserID: userId, ...normalizeSet(body), WordIDs: wordIds });
    } catch (error) {
        if (error.code === 11000) throw fail('A flashcard set with this name already exists', 409);
        throw error;
    }
};

const updateSet = async (userId, setId, body = {}) => {
    if (!isObjectId(setId)) throw fail('Flashcard set not found', 404);
    const Set = getSetModel();
    const set = await Set.findOne({ _id: setId, UserID: userId });
    if (!set) throw fail('Flashcard set not found', 404);
    const changes = {};
    if (body.Name !== undefined || body.Description !== undefined) Object.assign(changes, normalizeSet({
        Name: body.Name === undefined ? set.Name : body.Name,
        Description: body.Description === undefined ? set.Description : body.Description
    }));
    if (body.WordIDs !== undefined) {
        const wordIds = normalizeWordIds(body.WordIDs);
        await ensureSavedWords(userId, wordIds);
        changes.WordIDs = wordIds;
    }
    try {
        Object.assign(set, changes);
        await set.save();
        return set;
    } catch (error) {
        if (error.code === 11000) throw fail('A flashcard set with this name already exists', 409);
        throw error;
    }
};

const deleteSet = async (userId, setId) => {
    if (!isObjectId(setId)) throw fail('Flashcard set not found', 404);
    const Set = getSetModel();
    const result = await Set.findOneAndDelete({ _id: setId, UserID: userId });
    if (!result) throw fail('Flashcard set not found', 404);
    return result;
};

const listReviewCards = async (userId, query = {}, now = new Date()) => {
    const mode = query.mode || 'due';
    if (!['due', 'saved', 'topic', 'all'].includes(mode)) throw fail('Review mode must be due, saved, topic, or all');
    if (mode === 'topic' && !isObjectId(query.topicId)) throw fail('A valid topicId is required for topic review');
    const Saved = getSavedModel();
    const Word = getWordModel();
    const Review = getReviewModel();
    const saved = await Saved.find({ UserID: userId }).select('WordID').lean();
    const savedIds = [...new Set(saved.map(item => String(item.WordID)))];
    let wordIds = savedIds;
    if (mode === 'due' || mode === 'all' || mode === 'topic') {
        const masterFilter = { IsActive: true, IsDeleted: false };
        if (mode === 'topic') masterFilter.TopicID = query.topicId;
        const masterWords = await Word.find(masterFilter).select('_id').lean();
        wordIds = [...new Set([
            ...savedIds,
            ...masterWords.map(word => String(word._id))
        ])];
    }

    if (query.setId) {
        if (!isObjectId(query.setId)) throw fail('Flashcard set not found', 404);
        const Set = getSetModel();
        const set = await Set.findOne({ _id: query.setId, UserID: userId }).select('WordIDs').lean();
        if (!set) throw fail('Flashcard set not found', 404);
        const setWords = new Set((set.WordIDs || []).map(String));
        wordIds = wordIds.filter(wordId => setWords.has(wordId));
    }

    const filter = { _id: { $in: wordIds }, IsActive: true, IsDeleted: false };
    if (mode === 'topic') filter.TopicID = query.topicId;
    const [words, reviews] = await Promise.all([
        Word.find(filter).populate('TopicID', 'Name').sort({ Word: 1 }).lean(),
        Review.find({ UserID: userId, WordID: { $in: wordIds } }).lean()
    ]);
    const reviewByWord = new Map(reviews.map(review => [String(review.WordID), review]));
    let cards = words.map(word => {
        const review = reviewByWord.get(String(word._id));
        return {
            Word: word,
            Review: review || null,
            NextReviewAt: review?.NextReviewAt || null,
            Due: !review || new Date(review.NextReviewAt) <= now
        };
    });
    if (mode === 'due') cards = cards.filter(card => card.Due);
    if (query.dueOnly === 'true' && mode !== 'due') cards = cards.filter(card => card.Due);
    cards.sort((left, right) => {
        if (mode !== 'due' && query.dueOnly !== 'true') return left.Word.Word.localeCompare(right.Word.Word);
        const leftDue = left.NextReviewAt ? new Date(left.NextReviewAt).getTime() : 0;
        const rightDue = right.NextReviewAt ? new Date(right.NextReviewAt).getTime() : 0;
        return leftDue - rightDue || left.Word.Word.localeCompare(right.Word.Word);
    });

    const { page, limit, skip } = pagination(query.page, query.limit);
    const total = cards.length;
    return { items: cards.slice(skip, skip + limit), page, limit, total, pages: Math.ceil(total / limit), mode };
};

const reviewWord = async (userId, wordId, body = {}) => {
    if (!isObjectId(wordId)) throw fail('Vocabulary word not found', 404);
    const rating = clean(body.rating, 10).toLowerCase();
    const requestId = String(body.requestId ?? '').trim();
    if (!requestId) throw fail('requestId is required');
    if (requestId.length > 80) throw fail('requestId must be 80 characters or fewer');
    if (!['again', 'hard', 'good', 'easy'].includes(rating)) throw fail('Rating must be again, hard, good, or easy');

    const History = getHistoryModel();
    const existing = await History.findOne({ UserID: userId, RequestID: requestId }).lean();
    if (existing) {
        if (String(existing.WordID) !== wordId || existing.Rating !== rating) throw fail('requestId has already been used for a different review', 409);
        return existing;
    }

    const Word = getWordModel();
    const Review = getReviewModel();
    const [word, current] = await Promise.all([
        Word.findOne({ _id: wordId, IsActive: true, IsDeleted: false }).select('_id'),
        Review.findOne({ UserID: userId, WordID: wordId }).lean()
    ]);
    if (!word) throw fail('Vocabulary word not found', 404);

    const schedule = scheduleReview(current, rating);
    const wasCorrect = rating === 'good' || rating === 'easy';
    const totalReviewCount = (current?.TotalReviewCount || 0) + 1;
    const correctCount = (current?.CorrectCount || 0) + (wasCorrect ? 1 : 0);
    const incorrectCount = (current?.IncorrectCount || 0) + (wasCorrect ? 0 : 1);
    const memoryLevel = wasCorrect
        ? Math.min(5, (current?.MemoryLevel || 0) + (rating === 'easy' ? 2 : 1))
        : Math.max(0, (current?.MemoryLevel || 0) - 1);
    const currentStatus = memoryLevel >= 4
        ? 'Mastered'
        : totalReviewCount === 0
            ? 'New'
            : incorrectCount > correctCount
                ? 'Learning'
                : 'Reviewing';
    let history;
    try {
        history = await History.create({
            UserID: userId, WordID: wordId, RequestID: requestId, Rating: rating,
            IntervalDays: schedule.IntervalDays, NextReviewAt: schedule.NextReviewAt, ReviewedAt: schedule.ReviewedAt
        });
    } catch (error) {
        if (error.code === 11000) {
            const duplicate = await History.findOne({ UserID: userId, RequestID: requestId }).lean();
            if (duplicate && String(duplicate.WordID) === wordId && duplicate.Rating === rating) return duplicate;
            if (duplicate) throw fail('requestId has already been used for a different review', 409);
        }
        throw error;
    }

    try {
        await Review.findOneAndUpdate(
            { UserID: userId, WordID: wordId },
            { $set: {
                ...schedule,
                UserID: userId,
                WordID: wordId,
                TotalReviewCount: totalReviewCount,
                CorrectCount: correctCount,
                IncorrectCount: incorrectCount,
                MemoryLevel: memoryLevel,
                CurrentStatus: currentStatus
            } },
            { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
        );
    } catch (error) {
        await History.deleteOne({ _id: history._id }).catch(() => {});
        throw error;
    }
    return history;
};

const listHistory = async (userId, query = {}) => {
    const History = getHistoryModel();
    const { page, limit, skip } = pagination(query.page, query.limit);
    const filter = { UserID: userId };
    const [items, total] = await Promise.all([
        History.find(filter).populate({ path: 'WordID', populate: { path: 'TopicID', select: 'Name' } }).sort({ ReviewedAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
        History.countDocuments(filter)
    ]);
    return { items, page, limit, total, pages: Math.ceil(total / limit) };
};

module.exports = {
    normalizeWordIds,
    pagination,
    scheduleReview,
    listSets,
    createSet,
    updateSet,
    deleteSet,
    listReviewCards,
    reviewWord,
    listHistory
};
