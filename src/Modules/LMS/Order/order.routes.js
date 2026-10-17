const express = require('express');
const router = express.Router();
const controller = require('./order.controller');
const { authenticate } = require('../../../middlewares/auth.middleware');
const { authorize } = require('../../../middlewares/authorize.middleware');

router.post('/momo/ipn', controller.momoIpn);
router.get('/vnpay/ipn', controller.vnpayIpn);
router.get('/vnpay/return', controller.vnpayReturn);
router.post('/course/:courseId/payment', authenticate, authorize(['user']), controller.createPayment);
router.get('/course/:courseId', authenticate, authorize(['user']), controller.getCourseOrder);
router.get('/:orderId', authenticate, authorize(['user']), controller.getOrder);

module.exports = router;
