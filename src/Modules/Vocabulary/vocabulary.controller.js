const service = require('./vocabulary.service');

const ok = (res, data) => res.json({ success: true, data });
const fail = (res, error) => res.status(error.statusCode || (error.message?.includes('not found') ? 404 : 400)).json({ success: false, message: error.message || 'Vocabulary request failed' });
const wrap = handler => async (req, res) => { try { await handler(req, res); } catch (error) { console.error('[Vocabulary]', error.message); fail(res, error); } };

exports.listTopics = wrap(async (req, res) => ok(res, await service.listTopics({ includeInactive: req.user.role === 'admin' && req.query.includeInactive === 'true' })));
exports.listWords = wrap(async (req, res) => ok(res, await service.listWords({ topicId: req.query.topicId, search: req.query.search, includeInactive: req.user.role === 'admin' && req.query.includeInactive === 'true' })));
exports.dictionarySearch = wrap(async (req, res) => ok(res, await service.lookupWord(req.query.word)));
exports.createTopic = wrap(async (req, res) => ok(res, await service.createTopic(req.body, req.user.userId)));
exports.updateTopic = wrap(async (req, res) => ok(res, await service.updateTopic(req.params.topicId, req.body)));
exports.deleteTopic = wrap(async (req, res) => ok(res, await service.deleteTopic(req.params.topicId)));
exports.createWord = wrap(async (req, res) => ok(res, await service.createWord(req.body)));
exports.updateWord = wrap(async (req, res) => ok(res, await service.updateWord(req.params.wordId, req.body)));
exports.deleteWord = wrap(async (req, res) => ok(res, await service.deleteWord(req.params.wordId)));
exports.listSaved = wrap(async (req, res) => ok(res, await service.listSaved(req.user.userId)));
exports.saveWord = wrap(async (req, res) => ok(res, await service.saveWord(req.user.userId, req.params.wordId, req.body.Note)));
exports.saveExternalWord = wrap(async (req, res) => ok(res, await service.saveExternalWord(req.user.userId, req.body.word)));
exports.updateSaved = wrap(async (req, res) => ok(res, await service.updateSaved(req.user.userId, req.params.wordId, req.body)));
exports.removeSaved = wrap(async (req, res) => ok(res, await service.removeSaved(req.user.userId, req.params.wordId)));
exports.translate = wrap(async (req, res) => ok(res, await service.translate(req.body)));
exports.lookupWord = wrap(async (req, res) => ok(res, await service.lookupWord(req.body.word)));
exports.bulkImport = wrap(async (req, res) => ok(res, await service.bulkImport(req.body.topicId, req.body.words)));
