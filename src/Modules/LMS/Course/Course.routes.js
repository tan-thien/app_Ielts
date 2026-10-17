const express = require('express');
const router = express.Router();
const { createCourseController, updateCourseController, getCourseController, getCourseByIdController, deleteCourseController } = require('./Course.controller');
const orderController = require('../Order/order.controller');
const { authenticate } = require('../../../middlewares/auth.middleware');
const { authorize} = require('../../../middlewares/authorize.middleware');

router.post( '/create', authenticate, authorize(['admin']), createCourseController);
router.put('/update/:id',authenticate,authorize(['admin']),updateCourseController);
router.get('/get/:id', getCourseByIdController);
router.delete('/delete/:id', authenticate, authorize(['admin']), deleteCourseController);
router.get('/get-all', getCourseController);

module.exports = router;