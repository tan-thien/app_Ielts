const service = require('./ai.service');

const handle = action => async (req, res) => {
    try {
        const data = await action({ ...req.body, userId: req.user.userId });
        return res.status(200).json({ success: true, data });
    } catch (error) {
        const status = /required|empty|too long|must be|unsupported|oversized/.test(error.message)
            ? 400
            : error.statusCode || 502;
        if (status >= 500) {
            console.error('[AI] Evaluation request failed', {
                status,
                message: String(error.message || 'Unknown AI error').slice(0, 500)
            });
        }
        return res.status(status).json({ success: false, message: error.message });
    }
};

const streamHandle = action => async (req, res) => {
    const abortController = new AbortController();
    let closed = false;
    const heartbeat = setInterval(() => {
        if (!closed && !res.writableEnded) res.write(': ai-evaluation heartbeat\n\n');
    }, 15000);
    const abortForDisconnect = () => {
        if (res.writableEnded) return;
        closed = true;
        abortController.abort();
    };
    req.on('aborted', abortForDisconnect);
    res.on('close', abortForDisconnect);
    res.status(200);
    res.set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();
    const send = (event, data) => {
        if (closed || res.writableEnded) return;
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    send('started', { at: new Date().toISOString() });
    try {
        const attempt = await action({ ...req.body, userId: req.user.userId, signal: abortController.signal, onEvent: send });
        send('completed', { attempt });
    } catch (error) {
        if (error.statusCode !== 499 && !closed) {
            const status = error.statusCode || 502;
            console.error('[AI] Streaming evaluation failed', {
                status,
                message: String(error.message || 'Unknown AI error').slice(0, 500)
            });
            send('error', { status, message: error.message || 'AI evaluation failed' });
        }
    } finally {
        clearInterval(heartbeat);
        if (!res.writableEnded) res.end();
    }
};

module.exports = {
    evaluateWriting: handle(service.evaluateWriting),
    evaluateSpeaking: handle(service.evaluateSpeaking),
    streamWriting: streamHandle(service.streamWriting),
    streamSpeaking: streamHandle(service.streamSpeaking),
    history: async (req, res) => {
        try {
            const skill = req.query.skill;
            if (skill && !['Writing', 'Speaking'].includes(skill)) return res.status(400).json({ success: false, message: 'Invalid skill' });
            return res.json({ success: true, data: await service.getPracticeHistory(req.user.userId, skill) });
        } catch (error) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }
};
