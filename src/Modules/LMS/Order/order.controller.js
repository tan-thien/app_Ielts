const orderService = require('./order.service');

const createPayment = async (req, res) => {
    try {
        const result = await orderService.createPayment(
            req.params.courseId,
            req.user.userId,
            req.body.paymentMethod,
            req.ip
        );
        return res.status(result.alreadyPaid ? 200 : 201).json({
            success: true,
            data: {
                order: {
                    _id: result.order._id,
                    CourseID: result.order.CourseID,
                    Amount: result.order.Amount,
                    Currency: result.order.Currency,
                    Status: result.order.Status,
                    PaymentMethod: result.order.PaymentMethod,
                    PaidAt: result.order.PaidAt,
                    createdAt: result.order.createdAt
                },
                paymentUrl: result.paymentUrl || null,
                alreadyPaid: result.alreadyPaid
            }
        });
    } catch (error) {
        console.error('Create course payment error:', error.message);
        return res.status(error.statusCode || 400).json({
            success: false,
            message: error.message
        });
    }
};

const getOrder = async (req, res) => {
    try {
        const order = await orderService.getOrderForAccount(
            req.params.orderId,
            req.user.userId
        );
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }
        return res.json({ success: true, data: order });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

const getCourseOrder = async (req, res) => {
    try {
        const order = await orderService.getCourseOrderForAccount(
            req.params.courseId,
            req.user.userId
        );
        return res.json({ success: true, data: order });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

const getMyCourses = async (req, res) => {
    try {
        return res.json({ success: true, data: await orderService.getMyCourses(req.user.userId) });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
};

const momoIpn = async (req, res) => {
    try {
        await orderService.verifyMomoIpn(req.body);
        return res.json({ partnerCode: req.body.partnerCode, requestId: req.body.requestId, orderId: req.body.orderId, resultCode: 0, message: 'Success' });
    } catch (error) {
        console.error('MoMo IPN verification error:', error.message);
        return res.status(error.statusCode || 500).json({
            partnerCode: req.body.partnerCode,
            requestId: req.body.requestId,
            orderId: req.body.orderId,
            resultCode: 1,
            message: error.message
        });
    }
};

const vnpayIpn = async (req, res) => {
    try {
        return res.json(await orderService.processVnpayIpn(req.query));
    } catch (error) {
        console.error('VNPay IPN processing error:', error.message);
        return res.json({ RspCode: '99', Message: 'Unknown error' });
    }
};

const vnpayReturn = async (req, res) => {
    try {
        const order = await orderService.verifyVnpayCallback(req.query);
        const resultUrl = new URL('/payment/result', orderService.getVnpayReturnUrl());
        resultUrl.searchParams.set('orderId', order._id.toString());
        return res.redirect(302, resultUrl.toString());
    } catch (error) {
        console.error('VNPay return verification error:', error.message);
        const resultUrl = new URL('/payment/result', orderService.getVnpayReturnUrl());
        resultUrl.searchParams.set('payment', 'invalid');
        return res.redirect(302, resultUrl.toString());
    }
};

module.exports = { createPayment, getOrder, getCourseOrder, getMyCourses, momoIpn, vnpayIpn, vnpayReturn };
