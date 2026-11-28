const mongoose = require('mongoose');
const getJobModel = require('./vocabulary_generate.model');
const getTopicModel = require('./vocabulary_topic.model');
const getWordModel = require('./vocabulary_word.model');
const dictionaryService = require('./dictionary.service');
const vocabularyService = require('./vocabulary.service');

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const cleanWord = value => String(value || '').trim().toLocaleLowerCase('en').replace(/\s+/g, ' ').slice(0, 120);

const suggestWords = async ({ topicName, level, count }) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw fail('Gemini is not configured for vocabulary generation', 503);
    const model = encodeURIComponent(process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite');
    const prompt = [
        'Return JSON only.',
        `Generate exactly ${count} unique English vocabulary words or common phrases for an IELTS learner.`,
        `Topic: ${topicName}.`,
        `Level: ${level || 'B1-B2'}.`,
        'Prefer useful words, avoid duplicates and avoid proper nouns.',
        'Shape: {"words":["word1","word2"]}'
    ].join('\n');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.3, responseMimeType: 'application/json', maxOutputTokens: 1200 }
                })
            }
        );
        if (!response.ok) throw fail('Gemini could not generate vocabulary words', 502);
        const body = await response.json();
        const text = body.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
        const parsed = JSON.parse(text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim());
        return [...new Set((parsed.words || []).map(cleanWord).filter(Boolean))].slice(0, count);
    } catch (error) {
        if (error.statusCode) throw error;
        throw fail('Gemini returned invalid or incomplete vocabulary data', 502);
    } finally {
        clearTimeout(timeout);
    }
};

const getJob = async (userId, topicId) => {
    if (!mongoose.Types.ObjectId.isValid(topicId)) throw fail('Invalid topic');
    const Topic = getTopicModel();
    const topic = await Topic.findOne({ _id: topicId, IsDeleted: false, IsActive: true }).lean();
    if (!topic) throw fail('Topic not found', 404);
    return { topic };
};

const getPreviewJob = async (userId, jobId) => {
    if (!mongoose.Types.ObjectId.isValid(jobId)) throw fail('Generate job not found', 404);
    const Job = getJobModel();
    const job = await Job.findOne({ _id: jobId, UserID: userId });
    if (!job) throw fail('Generate job not found', 404);
    return job;
};

const startGenerate = async (userId, body = {}) => {
    const targetCount = Number(body.targetCount);
    if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > 500) throw fail('Target count must be between 1 and 500');
    const level = String(body.level || '').trim().slice(0, 40);
    const { topic } = await getJob(userId, body.topicId);
    const Job = getJobModel();
    const existing = await Job.findOne({ UserID: userId, TopicID: topic._id, BatchStatus: { $in: ['Idle', 'Processing', 'Error'] } }).sort({ updatedAt: -1 });
    if (existing && existing.ApprovedCount < existing.TargetCount) return existing;
    return Job.create({
        UserID: userId,
        TopicID: topic._id,
        Level: level,
        TargetCount: targetCount,
        BatchStatus: 'Idle',
        Previews: []
    });
};

const runNextBatch = async (userId, jobId) => {
    const job = await getPreviewJob(userId, jobId);
    if (job.BatchStatus === 'Processing') throw fail('A batch is already processing', 409);
    if (job.ApprovedCount >= job.TargetCount) {
        job.BatchStatus = 'Completed';
        await job.save();
        return job;
    }
    const remaining = job.TargetCount - job.ApprovedCount;
    const batchSize = Math.min(20, remaining);
    job.BatchStatus = 'Processing';
    job.BatchNumber += 1;
    job.ErrorMessage = '';
    await job.save();
    try {
        const Topic = getTopicModel();
        const topic = await Topic.findById(job.TopicID).lean();
        if (!topic) throw fail('Topic not found', 404);
        const suggestions = await suggestWords({ topicName: topic.Name, level: job.Level, count: batchSize });
        const Word = getWordModel();
        const previews = [];
        let duplicateCount = 0;
        for (const word of suggestions) {
            const existing = await Word.findOne({
                $or: [
                    { NormalizedWord: word, IsDeleted: false },
                    { Word: new RegExp(`^${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), IsDeleted: false }
                ]
            }).lean();
            if (existing) {
                duplicateCount += 1;
                continue;
            }
            try {
                const data = await dictionaryService.lookupWord(word);
                previews.push({
                    Key: `${job.BatchNumber}:${word}`,
                    Word: data.Word,
                    Preview: data,
                    Status: 'Pending',
                    Error: ''
                });
            } catch (error) {
                previews.push({
                    Key: `${job.BatchNumber}:${word}`,
                    Word: word,
                    Preview: {},
                    Status: 'Rejected',
                    Error: error.message || 'Dictionary lookup failed'
                });
            }
        }
        job.Previews.push(...previews);
        job.GeneratedCount += suggestions.length;
        job.ValidCount += previews.filter(item => item.Status === 'Pending').length;
        job.DuplicateCount += duplicateCount;
        job.BatchStatus = previews.length ? 'Completed' : 'Error';
        job.ErrorMessage = previews.some(item => item.Error) ? 'Some words could not be looked up; review the remaining previews.' : '';
        await job.save();
        return job;
    } catch (error) {
        job.BatchStatus = 'Error';
        job.ErrorMessage = error.message || 'Vocabulary batch failed';
        await job.save();
        return job;
    }
};

const updatePreview = async (userId, jobId, previewKey, body = {}) => {
    const job = await getPreviewJob(userId, jobId);
    const preview = job.Previews.find(item => item.Key === previewKey);
    if (!preview) throw fail('Preview not found', 404);
    if (body.remove === true) {
        preview.Status = 'Rejected';
        preview.Error = 'Removed by administrator';
    } else if (body.preview && typeof body.preview === 'object') {
        preview.Preview = { ...preview.Preview, ...body.preview };
    }
    await job.save();
    return job;
};

const approveBatch = async (userId, jobId, previewKeys = []) => {
    const job = await getPreviewJob(userId, jobId);
    const Topic = getTopicModel();
    const topic = await Topic.findById(job.TopicID).lean();
    if (!topic) throw fail('Topic not found', 404);
    const keys = new Set(Array.isArray(previewKeys) ? previewKeys : []);
    let approved = 0;
    for (const preview of job.Previews) {
        if (preview.Status !== 'Pending') continue;
        if (keys.size && !keys.has(preview.Key)) continue;
        const data = preview.Preview || {};
        if (!data.Word || !Array.isArray(data.Senses) || !data.Senses.length) continue;
        const remaining = job.TargetCount - job.ApprovedCount;
        if (remaining <= 0) break;
        await vocabularyService.createWord({
            ...data,
            TopicID: String(job.TopicID),
            TopicIDs: [String(job.TopicID)],
            IsActive: true
        });
        preview.Status = 'Approved';
        approved += 1;
        job.ApprovedCount += 1;
    }
    job.BatchStatus = job.ApprovedCount >= job.TargetCount ? 'Completed' : 'Idle';
    await job.save();
    return { job, approved };
};

const listJobs = async (userId, topicId) => {
    const Job = getJobModel();
    const filter = { UserID: userId };
    if (topicId && mongoose.Types.ObjectId.isValid(topicId)) filter.TopicID = topicId;
    return Job.find(filter).sort({ updatedAt: -1 }).limit(20).lean();
};

module.exports = {
    startGenerate,
    runNextBatch,
    updatePreview,
    approveBatch,
    listJobs,
    suggestWords,
    _test: { cleanWord }
};
