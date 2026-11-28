const service = require('./speaking-conversation.service');

const sendError = (res, error) => {
    const status = error.statusCode || 500;
    if (status >= 500 && status !== 503 && status !== 504) {
        console.error('[Speaking Conversation] Request failed', {
            code: error.code || 'INTERNAL_ERROR',
            message: String(error.message || 'Unknown error').slice(0, 300)
        });
    }
    const message = status >= 500
        ? 'Speaking conversation is temporarily unavailable. Please try again.'
        : error.message;
    return res.status(status).json({ success: false, code: error.code, message });
};

const handle = action => async (req, res) => {
    const abortController = new AbortController();
    const abortOnDisconnect = () => {
        if (!res.writableEnded) abortController.abort();
    };
    req.on('aborted', abortOnDisconnect);
    res.on('close', abortOnDisconnect);
    try {
        const data = await action(req, abortController.signal);
        if (!res.writableEnded && !abortController.signal.aborted) {
            return res.json({ success: true, data });
        }
    } catch (error) {
        if (!res.writableEnded && !abortController.signal.aborted) return sendError(res, error);
    } finally {
        req.off('aborted', abortOnDisconnect);
        res.off('close', abortOnDisconnect);
    }
};

module.exports = {
    list: handle(req => service.listSessions(req.user.userId)),
    create: handle((req, signal) => service.createSession(req.user.userId, req.body, { signal })),
    get: handle(req => service.getSession(req.user.userId, req.params.sessionId)),
    sendMessage: handle((req, signal) => service.sendMessage(req.user.userId, req.params.sessionId, req.body, { signal })),
    end: handle((req, signal) => service.endSession(req.user.userId, req.params.sessionId, { signal })),
    _test: { sendError }
};
