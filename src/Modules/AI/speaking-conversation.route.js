const express = require('express');
const controller = require('./speaking-conversation.controller');
const { authenticate } = require('../../middlewares/auth.middleware');

const router = express.Router();
router.use(authenticate);
router.get('/sessions', controller.list);
router.post('/sessions', controller.create);
router.get('/sessions/:sessionId', controller.get);
router.post('/sessions/:sessionId/messages', controller.sendMessage);
router.post('/sessions/:sessionId/end', controller.end);

module.exports = router;
