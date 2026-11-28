const express = require('express');
const { authenticate } = require('../../middlewares/auth.middleware');
const controller = require('./progress-analytics.controller');

const router = express.Router();
router.use(authenticate);
router.get('/analytics', controller.getAnalytics);
router.get('/plan', controller.getPlan);
router.put('/plan', controller.savePlan);
router.patch('/plan/tasks/:taskId/complete', controller.completeTask);

module.exports = router;
