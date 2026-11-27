const { randomUUID, createHash } = require('node:crypto');
const service = require('./ai.service');

const activeRequests = new Set();

const getStatus = error => {
    if (/required|empty|too long|must be|unsupported|oversized|does not match|base64|MIME type|cannot be|invalid AI request identifier/i.test(error.message || '')) return 400;
    return error.statusCode || 502;
};

const getPublicMessage = (error, status) => {
    if (error.code === 'AI_REPAIR_FAILED') return 'AI chưa thể tạo báo cáo hợp lệ sau một lần sửa. Bài làm vẫn được giữ lại; vui lòng thử lại.';
    if (error.code === 'SPEECH_NO_AUDIO') return 'Không phát hiện âm thanh có thể nghe được. Kiểm tra microphone hoặc chọn lại bản ghi rồi thử lại.';
    if (error.code === 'SPEECH_TOO_QUIET') return 'Âm thanh quá nhỏ để nhận diện đáng tin cậy. Tăng âm lượng đầu vào và thu âm lại.';
    if (error.code === 'SPEECH_NON_SPEECH') return 'Bản ghi có âm thanh nhưng không nhận diện được câu trả lời bằng lời nói. Hãy thu âm lại.';
    if (error.code === 'SPEECH_UNINTELLIGIBLE') return 'Có thể nghe thấy lời nói nhưng chưa thể nhận diện chính xác. Hãy nghe lại hoặc thu âm lại.';
    if (error.code === 'SPEECH_TRANSCRIPT_UNRELIABLE') return 'Chưa đủ chắc chắn về bản ghi lời nói để chấm điểm. Hãy nghe lại hoặc thu âm lại.';
    if (status === 400) {
        const message = String(error.message || '');
        if (message.includes('Writing response')) return 'Bài viết không hợp lệ hoặc vượt quá giới hạn. Hãy kiểm tra nội dung rồi thử lại.';
        if (message.includes('Task prompt')) return 'Đề bài không hợp lệ hoặc vượt quá giới hạn.';
        if (message.includes('Speaking question')) return 'Câu hỏi không hợp lệ hoặc vượt quá giới hạn.';
        if (message.includes('Speaking part')) return 'Hãy chọn Part Speaking từ 1 đến 3.';
        if (message.includes('Audio') || message.includes('audio')) return 'Bản ghi không hợp lệ, quá lớn hoặc không khớp định dạng. Hãy thu âm lại.';
        if (message.includes('image')) return 'Ảnh đề bài không hợp lệ. Chỉ hỗ trợ PNG, JPEG hoặc WebP dưới 5 MB.';
        return 'Dữ liệu gửi lên chưa hợp lệ. Hãy kiểm tra nội dung rồi thử lại.';
    }
    if (status === 422) return 'Không thể xác nhận bản ghi lời nói đủ tin cậy để chấm điểm. Hãy nghe lại hoặc thu âm lại.';
    if (status === 429 || status === 503) return 'Dịch vụ AI đang quá tải. Vui lòng đợi một chút rồi thử lại.';
    if (status === 504) return 'AI xử lý quá thời hạn. Nội dung của bạn vẫn được giữ lại; vui lòng thử lại.';
    if (status === 499) return 'Yêu cầu đánh giá đã bị hủy.';
    return 'AI chưa thể hoàn tất đánh giá hợp lệ. Nội dung của bạn vẫn được giữ lại; vui lòng thử lại.';
};

const acquireRequest = (req, attemptId = randomUUID()) => {
    const body = req.body || {};
    const evaluationPayload = { ...body };
    delete evaluationPayload.requestId;
    const requestId = typeof body.requestId === 'string' && body.requestId
        ? body.requestId
        : randomUUID();
    const key = createHash('sha256')
        .update(`${req.user.userId}:${req.path}:${JSON.stringify(evaluationPayload)}`)
        .digest('hex');
    if (activeRequests.has(key)) return null;
    activeRequests.add(key);
    return { key, requestId, attemptId };
};

const attachCancellation = (req, res, controller) => {
    const abort = () => {
        if (!res.writableEnded) controller.abort();
    };
    req.on('aborted', abort);
    res.on('close', abort);
    return () => {
        req.off('aborted', abort);
        res.off('close', abort);
    };
};

const handle = (action, practiceType) => async (req, res) => {
    const attemptId = randomUUID();
    const reservation = acquireRequest(req, attemptId);
    if (!reservation) {
        return res.status(409).json({
            success: false,
            message: 'Bài làm này đang được đánh giá. Vui lòng chờ kết quả hiện tại.'
        });
    }

    const startedAt = Date.now();
    const abortController = new AbortController();
    const detachCancellation = attachCancellation(req, res, abortController);
    try {
        const data = await action({
            ...req.body,
            requestId: reservation.requestId,
            userId: req.user.userId,
            signal: abortController.signal
        });
        if (!res.writableEnded && !abortController.signal.aborted) {
            res.status(200).json({ success: true, data });
        }
        console.info('[AI] Evaluation request completed', {
            requestId: reservation.requestId,
            attemptId: reservation.attemptId,
            practiceType,
            model: service.getModelName(),
            status: abortController.signal.aborted ? 'completed-client-disconnected' : 'completed',
            elapsedMs: Date.now() - startedAt
        });
    } catch (error) {
        const status = getStatus(error);
        if (status >= 500 && status !== 499) {
            console.error('[AI] Evaluation request failed', {
                requestId: reservation.requestId,
                attemptId: reservation.attemptId,
                practiceType,
                model: service.getModelName(),
                status,
                elapsedMs: Date.now() - startedAt,
                message: String(error.message || 'Unknown AI error').slice(0, 500)
            });
        }
        if (!res.writableEnded && !abortController.signal.aborted) {
            res.status(status).json({ success: false, message: getPublicMessage(error, status) });
        }
    } finally {
        detachCancellation();
        activeRequests.delete(reservation.key);
    }
};

const streamHandle = (action, practiceType) => async (req, res) => {
    const attemptId = randomUUID();
    const reservation = acquireRequest(req, attemptId);
    if (!reservation) {
        console.warn('[AI] Streaming evaluation attempt finished', {
            requestId: req.body?.requestId || null,
            attemptId,
            practiceType,
            model: service.getModelName(),
            finalStatus: 'failed',
            statusCode: 409,
            elapsedMs: 0,
            reasonCode: 'DUPLICATE_IN_FLIGHT'
        });
        return res.status(409).json({
            success: false,
            message: 'Bài làm này đang được đánh giá. Vui lòng chờ kết quả hiện tại.'
        });
    }

    const startedAt = Date.now();
    let finalStatus = 'failed';
    let finalStatusCode = 500;
    let finalError = null;
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
    send('started', { at: new Date().toISOString(), requestId: reservation.requestId });
    console.info('[AI] Streaming evaluation attempt started', {
        requestId: reservation.requestId,
        attemptId: reservation.attemptId,
        practiceType,
        model: service.getModelName(),
        phase: 'initial_stream'
    });
    try {
        const attempt = await action({
            ...req.body,
            requestId: reservation.requestId,
            attemptId: reservation.attemptId,
            userId: req.user.userId,
            signal: abortController.signal,
            onEvent: send
        });
        send('completed', { attempt });
        finalStatus = 'completed';
        finalStatusCode = 200;
    } catch (error) {
        const status = getStatus(error);
        finalError = error;
        finalStatusCode = status;
        if (status !== 499 && !closed) send('error', { status, code: error.code, message: getPublicMessage(error, status) });
    } finally {
        const finalLog = {
            requestId: reservation.requestId,
            attemptId: reservation.attemptId,
            practiceType,
            model: service.getModelName(),
            finalStatus,
            statusCode: finalStatusCode,
            elapsedMs: Date.now() - startedAt,
            ...(closed ? { clientDisconnected: true } : {}),
            ...(finalError ? {
                reasonCode: finalError.code || 'AI_EVALUATION_FAILED',
                ...(finalError.repairErrorCode ? { repairErrorCode: finalError.repairErrorCode } : {}),
                ...(Number.isInteger(finalError.transcriptLength) ? { transcriptLength: finalError.transcriptLength } : {}),
                message: String(finalError.message || 'Unknown AI error').slice(0, 500)
            } : {})
        };
        if (finalStatus === 'completed') console.info('[AI] Streaming evaluation attempt finished', finalLog);
        else console.error('[AI] Streaming evaluation attempt finished', finalLog);
        clearInterval(heartbeat);
        req.off('aborted', abortForDisconnect);
        res.off('close', abortForDisconnect);
        activeRequests.delete(reservation.key);
        if (!res.writableEnded) res.end();
    }
};

module.exports = {
    evaluateWriting: handle(service.evaluateWriting, 'Writing'),
    evaluateSpeaking: handle(service.evaluateSpeaking, 'Speaking'),
    streamWriting: streamHandle(service.streamWriting, 'Writing'),
    streamSpeaking: streamHandle(service.streamSpeaking, 'Speaking'),
    history: async (req, res) => {
        try {
            const skill = req.query.skill;
            if (skill && !['Writing', 'Speaking'].includes(skill)) return res.status(400).json({ success: false, message: 'Invalid skill' });
            return res.json({ success: true, data: await service.getPracticeHistory(req.user.userId, skill) });
        } catch (error) {
            console.error('[AI] Could not load evaluation history', {
                userId: req.user.userId,
                message: String(error.message || 'Unknown error').slice(0, 300)
            });
            return res.status(500).json({ success: false, message: 'Không thể tải lịch sử luyện tập. Vui lòng thử lại.' });
        }
    },
    _test: { streamHandle, acquireRequest }
};
