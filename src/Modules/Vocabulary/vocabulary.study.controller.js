const service = require('./vocabulary.study.service');

const ok = (res, data) => res.json({ success: true, data });
const fail = (res, error) => res.status(error.statusCode || (error.message?.includes('not found') ? 404 : 400)).json({ success: false, message: error.message || 'Vocabulary study request failed' });
const wrap = handler => async (req, res) => {
    try {
        await handler(req, res);
    } catch (error) {
        console.error('[Vocabulary study]', error.message);
        fail(res, error);
    }
};

exports.listSets = wrap(async (req, res) => ok(res, await service.listSets(req.user.userId, req.query)));
exports.createSet = wrap(async (req, res) => ok(res, await service.createSet(req.user.userId, req.body)));
exports.updateSet = wrap(async (req, res) => ok(res, await service.updateSet(req.user.userId, req.params.setId, req.body)));
exports.deleteSet = wrap(async (req, res) => ok(res, await service.deleteSet(req.user.userId, req.params.setId)));
exports.listReviewCards = wrap(async (req, res) => ok(res, await service.listReviewCards(req.user.userId, req.query)));
exports.reviewWord = wrap(async (req, res) => ok(res, await service.reviewWord(req.user.userId, req.params.wordId, req.body)));
exports.listHistory = wrap(async (req, res) => ok(res, await service.listHistory(req.user.userId, req.query)));
