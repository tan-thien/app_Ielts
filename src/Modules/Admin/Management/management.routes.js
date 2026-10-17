const express = require('express');
const router = express.Router();
const controller = require('./management.controller');
const { authenticate } = require('../../../middlewares/auth.middleware');
const { authorize } = require('../../../middlewares/authorize.middleware');

router.use(authenticate, authorize(['admin']));
router.get('/dashboard', controller.getDashboard);
router.get('/reports', controller.getReports);
router.put('/accounts/:accountId/role', controller.setAccountRole);
router.put('/courses/:courseId/teachers', controller.setCourseTeachers);

module.exports = router;
