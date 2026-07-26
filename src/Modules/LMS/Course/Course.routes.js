const express = require('express');
const router = express.Router();
const { createCourseController, updateCourseController, getCourseController, getCourseByIdController, deleteCourseController } = require('./Course.controller');
const { authenticate } = require('../../../middlewares/auth.middleware');
const { authorize} = require('../../../middlewares/authorize.middleware');

router.post( '/create', authenticate, authorize(['admin']), createCourseController);
router.put('/update/:id',authenticate,authorize(['admin']),updateCourseController);
router.get('/get/:id', authenticate, getCourseByIdController);
router.delete('/delete/:id', authenticate, authorize(['admin']), deleteCourseController);
router.get('/get-all', authenticate, getCourseController);

module.exports = router;