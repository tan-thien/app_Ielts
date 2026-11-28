const mongoose = require('mongoose');
const { getDB_LMS } = require('../../config/db_Account');

const sessionSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    mode: { type: String, enum: ['free', 'topic'], required: true },
    part: { type: String, enum: ['1', '2', '3'], required: true },
    topic: { type: String, default: '' },
    status: { type: String, enum: ['active', 'completed'], default: 'active', index: true },
    turnInProgress: { type: Boolean, default: false },
    userTurnCount: { type: Number, default: 0 },
    messageCount: { type: Number, default: 0 },
    startedAt: { type: Date, default: Date.now },
    lastActivityAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null }
}, { timestamps: true });

const messageSchema = new mongoose.Schema({
    sessionId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    userId: { type: String, required: true, index: true },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true, maxlength: 3000 },
    createdAt: { type: Date, default: Date.now }
}, { versionKey: false });
messageSchema.index({ sessionId: 1, createdAt: 1 });

const resultSchema = new mongoose.Schema({
    sessionId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
    userId: { type: String, required: true, index: true },
    summary: { type: String, required: true, maxlength: 1200 },
    strengths: { type: [String], default: [] },
    focusAreas: { type: [String], default: [] },
    evidence: [{
        quote: { type: String, required: true, maxlength: 300 },
        observation: { type: String, required: true, maxlength: 500 }
    }],
    disclaimer: { type: String, required: true }
}, { timestamps: true });

const getModels = () => {
    const db = getDB_LMS();
    if (!db) throw new Error('Speaking conversation database is not configured');
    return {
        Session: db.models.SpeakingConversationSession
            || db.model('SpeakingConversationSession', sessionSchema),
        Message: db.models.SpeakingConversationMessage
            || db.model('SpeakingConversationMessage', messageSchema),
        Result: db.models.SpeakingConversationResult
            || db.model('SpeakingConversationResult', resultSchema)
    };
};

const createSession = async values => {
    const { Session } = getModels();
    return Session.create(values);
};

const findOwnedSession = async (sessionId, userId) => {
    const { Session } = getModels();
    return Session.findOne({ _id: sessionId, userId }).lean();
};

const listSessions = async userId => {
    const { Session } = getModels();
    return Session.find({ userId }).sort({ lastActivityAt: -1 }).limit(20).lean();
};

const listMessages = async (sessionId, limit) => {
    const { Message } = getModels();
    const messages = await Message.find({ sessionId })
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit)
        .lean();
    return messages.reverse();
};

const addMessage = async values => {
    const { Message } = getModels();
    return Message.create(values);
};

const updateSession = async (sessionId, userId, values) => {
    const { Session } = getModels();
    return Session.findOneAndUpdate(
        { _id: sessionId, userId },
        { $set: values },
        { new: true, runValidators: true }
    ).lean();
};

const claimTurn = async (sessionId, userId, maxUserTurns) => {
    const { Session } = getModels();
    return Session.findOneAndUpdate(
        {
            _id: sessionId,
            userId,
            status: 'active',
            turnInProgress: { $ne: true },
            userTurnCount: { $lt: maxUserTurns }
        },
        { $set: { turnInProgress: true } },
        { new: true, runValidators: true }
    ).lean();
};

const claimResult = async (sessionId, userId, minUserTurns) => {
    const { Session } = getModels();
    return Session.findOneAndUpdate(
        {
            _id: sessionId,
            userId,
            status: 'active',
            turnInProgress: { $ne: true },
            userTurnCount: { $gte: minUserTurns }
        },
        { $set: { turnInProgress: true } },
        { new: true, runValidators: true }
    ).lean();
};

const findResult = async (sessionId, userId) => {
    const { Result } = getModels();
    return Result.findOne({ sessionId, userId }).lean();
};

const saveResult = async (sessionId, userId, values) => {
    const { Result } = getModels();
    return Result.findOneAndUpdate(
        { sessionId, userId },
        { $set: { ...values, sessionId, userId } },
        { new: true, upsert: true, runValidators: true }
    ).lean();
};

module.exports = {
    createSession,
    findOwnedSession,
    listSessions,
    listMessages,
    addMessage,
    updateSession,
    claimTurn,
    claimResult,
    findResult,
    saveResult
};
