const express = require('express');
const controller = require('./vocabulary.controller');
const { authenticate } = require('../../middlewares/auth.middleware');
const { authorize } = require('../../middlewares/authorize.middleware');

const router = express.Router();
router.use(authenticate);
router.get('/topics', controller.listTopics);
router.get('/words', controller.listWords);
router.get('/dictionary/search', authorize(['user', 'teacher', 'admin']), controller.dictionarySearch);
router.get('/saved', authorize(['user', 'teacher', 'admin']), controller.listSaved);
router.post('/saved/external', authorize(['user', 'teacher', 'admin']), controller.saveExternalWord);
router.post('/saved/:wordId', authorize(['user', 'teacher', 'admin']), controller.saveWord);
router.put('/saved/:wordId', authorize(['user', 'teacher', 'admin']), controller.updateSaved);
router.delete('/saved/:wordId', authorize(['user', 'teacher', 'admin']), controller.removeSaved);
router.post('/translate', authorize(['user', 'teacher', 'admin']), controller.translate);
router.post('/admin/lookup', authorize(['admin']), controller.lookupWord);
router.post('/admin/import', authorize(['admin']), controller.bulkImport);
router.post('/admin/topics', authorize(['admin']), controller.createTopic);
router.put('/admin/topics/:topicId', authorize(['admin']), controller.updateTopic);
router.delete('/admin/topics/:topicId', authorize(['admin']), controller.deleteTopic);
router.post('/admin/words', authorize(['admin']), controller.createWord);
router.put('/admin/words/:wordId', authorize(['admin']), controller.updateWord);
router.delete('/admin/words/:wordId', authorize(['admin']), controller.deleteWord);

module.exports = router;
