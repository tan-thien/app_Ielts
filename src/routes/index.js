const express = require('express');
const router = express.Router();

router.use('/auth', require('../Modules/auth/auth.route'));
router.use('/courses', require('../Modules/LMS/Course/Course.routes'));
router.use('/orders', require('../Modules/LMS/Order/order.routes'));
router.use('/lessons', require('../Modules/LMS/lesson/lesson.routes'));
router.use("/lesson-details", require('../Modules/LMS/lesson/lesson_detail.routes'));
router.use('/assignment',require('../Modules/LMS/Assignment/assignment.route'));
router.use('/submition',require('../Modules/LMS/Submission/submission.route'));
router.use('/ai', require('../Modules/AI/ai.route'));
router.use('/admin/management', require('../Modules/Admin/Management/management.routes'));
router.use('/vocabulary', require('../Modules/Vocabulary/vocabulary.routes'));


module.exports = router;
