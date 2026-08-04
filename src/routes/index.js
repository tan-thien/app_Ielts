const express = require('express');
const router = express.Router();

router.use('/auth', require('../modules/auth/auth.route'));
router.use('/courses', require('../modules/LMS/Course/Course.routes'));
router.use('/lessons', require('../modules/LMS/lesson/lesson.routes'));
router.use("/lesson-details", require('../modules/LMS/lesson/lesson_detail.routes'));
router.use('/assignment',require('../Modules/LMS/Assignment/assignment.route'));
router.use('/submition',require('../Modules/LMS/Submission/submission.route'));


module.exports = router;