const express = require('express');
const router = express.Router();
const controller = require('./ai.controller');
const { authenticate } = require('../../middlewares/auth.middleware');

router.use(authenticate);
router.post('/writing/evaluate', controller.evaluateWriting);
router.post('/speaking/evaluate', controller.evaluateSpeaking);
router.post('/writing/evaluate/stream', controller.streamWriting);
router.post('/speaking/evaluate/stream', controller.streamSpeaking);
router.get('/history', controller.history);

module.exports = router;
