const express = require('express');
const router = express.Router();

router.use('/auth', require('../modules/auth/auth.route'));
router.use('/courses', require('../modules/LMS/Course/Course.routes'));

module.exports = router;