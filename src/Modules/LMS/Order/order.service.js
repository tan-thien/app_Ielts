const crypto = require('crypto');
const getCourseModel = require('../Course/Course.model');
const getOrderModel = require('./Order.model');
const getLessonModel = require('../lesson/lesson.model');
const getLessonProgressModel = require('../LessonProgress/lesson-progress.model');

const requiredMomoConfig = () => {
    const config = {
        partnerCode: process.env.MOMO_PARTNER_CODE,
        accessKey: process.env.MOMO_ACCESS_KEY,
        secretKey: process.env.MOMO_SECRET_KEY,
        ipnUrl: process.env.MOMO_IPN_URL,
        frontendUrl: process.env.FRONTEND_URL
    };
    const missing = Object.entries(config)
        .filter(([, value]) => !value)
        .map(([key]) => key);

    if (missing.length) {
        const error = new Error(`Missing MoMo configuration: ${missing.join(', ')}`);
        error.statusCode = 500;
        throw error;
    }
    return config;
};

const sign = (message, secretKey) =>
    crypto.createHmac('sha256', secretKey).update(message, 'utf8').digest('hex');

const requiredVnpayConfig = () => {
    const config = {
        tmnCode: process.env.VNPAY_TMN_CODE,
        hashSecret: process.env.VNPAY_HASH_SECRET,
        paymentUrl: process.env.VNPAY_URL,
        returnUrl: process.env.VNPAY_RETURN_URL,
        frontendUrl: process.env.FRONTEND_URL
    };
    const missing = Object.entries(config)
        .filter(([, value]) => !value)
        .map(([key]) => key);

    if (missing.length) {
        const error = new Error(`Missing VNPay configuration: ${missing.join(', ')}`);
        error.statusCode = 500;
        throw error;
    }
    return config;
};

const signVnpay = (message, secretKey) =>
    crypto.createHmac('sha512', secretKey).update(message, 'utf8').digest('hex');

const encodeVnpay = (value) =>
    encodeURIComponent(String(value)).replace(/%20/g, '+');

const getVnpayParams = (params) =>
    Object.keys(params)
        .filter((key) =>
            key.startsWith('vnp_') &&
            key !== 'vnp_SecureHash' &&
            key !== 'vnp_SecureHashType' &&
            params[key] !== undefined &&
            params[key] !== ''
        )
        .map((key) => [encodeURIComponent(key), encodeVnpay(params[key])])
        .sort(([leftKey], [rightKey]) =>
            leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
        );

const serializeVnpayParams = (params) =>
    getVnpayParams(params)
        .map(([key, value]) => `${key}=${value}`)
        .join('&');

const getClientIp = (ip) => {
    if (typeof ip !== 'string' || !ip) return '127.0.0.1';
    if (ip === '::1') return '127.0.0.1';
    return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
};

const formatVnpayDate = (date) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}${values.month}${values.day}${values.hour}${values.minute}${values.second}`;
};

const createPayment = async (courseId, accountId, paymentMethod = 'MoMo', clientIp) => {
    if (!['MoMo', 'VNPAY', 'Free'].includes(paymentMethod)) {
        const error = new Error('Unsupported payment method');
        error.statusCode = 400;
        throw error;
    }
    const Course = getCourseModel();
    const Order = getOrderModel();
    const course = await Course.findOne({ _id: courseId, IsDeleted: false });

    if (!course) {
        const error = new Error('Course not found');
        error.statusCode = 404;
        throw error;
    }
    if (!course.Status || !course.IsOpen) {
        const error = new Error('Course is not open for purchase');
        error.statusCode = 400;
        throw error;
    }

    const existingPaidOrder = await Order.findOne({
        CourseID: course._id,
        AccountID: accountId,
        Status: 'Paid'
    });
    if (existingPaidOrder) {
        return { order: existingPaidOrder, alreadyPaid: true };
    }

    if (!Number.isSafeInteger(course.Fee) || course.Fee < 0) {
        const error = new Error('Course price must be a non-negative whole number of VND');
        error.statusCode = 400;
        throw error;
    }

    if (course.Fee === 0) {
        const order = await Order.create({
            CourseID: course._id,
            AccountID: accountId,
            Amount: 0,
            PaymentMethod: 'Free',
            Status: 'Paid',
            PaidAt: new Date()
        });
        return { order, alreadyPaid: false };
    }

    if (paymentMethod === 'Free') {
        const error = new Error('Free payment is only available for free courses');
        error.statusCode = 400;
        throw error;
    }

    if (paymentMethod === 'VNPAY') {
        if (course.Fee < 5000) {
            const error = new Error('VNPay requires a minimum payment of 5,000 VND');
            error.statusCode = 400;
            throw error;
        }
        await Order.updateMany(
            {
                CourseID: course._id,
                AccountID: accountId,
                Status: 'Pending',
                PaymentMethod: 'VNPAY',
                createdAt: { $lt: new Date(Date.now() - 14 * 60 * 1000) }
            },
            { $set: { Status: 'Failed' } }
        );
    }

    if (paymentMethod === 'MoMo') {
        const pendingOrder = await Order.findOne({
            CourseID: course._id,
            AccountID: accountId,
            Status: 'Pending',
            PaymentMethod: paymentMethod,
            Amount: course.Fee,
            PaymentUrl: { $exists: true, $ne: '' }
        }).sort({ createdAt: -1 });
        if (pendingOrder) {
            return {
                order: pendingOrder,
                paymentUrl: pendingOrder.PaymentUrl,
                alreadyPaid: false
            };
        }
    }

    if (paymentMethod === 'VNPAY') {
        return createVnpayPayment(course, accountId, clientIp, Order);
    }

    const config = requiredMomoConfig();
    const requestId = crypto.randomUUID();
    const order = await Order.create({
        CourseID: course._id,
        AccountID: accountId,
        Amount: course.Fee,
        Currency: 'VND',
        PaymentMethod: 'MoMo',
        Status: 'Pending',
        MomoRequestId: requestId
    });
    const orderId = order._id.toString();
    order.MomoOrderId = orderId;
    await order.save();
    const redirectUrl = `${config.frontendUrl.replace(/\/$/, '')}/payment/result?orderId=${encodeURIComponent(orderId)}`;
    const orderInfo = 'Thanh toan khoa hoc IELTS';
    const requestType = 'captureWallet';
    const extraData = '';
    const rawSignature = [
        `accessKey=${config.accessKey}`,
        `amount=${order.Amount}`,
        `extraData=${extraData}`,
        `ipnUrl=${config.ipnUrl}`,
        `orderId=${orderId}`,
        `orderInfo=${orderInfo}`,
        `partnerCode=${config.partnerCode}`,
        `redirectUrl=${redirectUrl}`,
        `requestId=${requestId}`,
        `requestType=${requestType}`
    ].join('&');
    const requestBody = {
        partnerCode: config.partnerCode,
        requestId,
        amount: order.Amount,
        orderId,
        orderInfo,
        redirectUrl,
        ipnUrl: config.ipnUrl,
        requestType,
        extraData,
        lang: 'vi',
        autoCapture: true,
        signature: sign(rawSignature, config.secretKey)
    };

    const momoEndpoint =
        process.env.MOMO_ENDPOINT || 'https://test-payment.momo.vn/v2/gateway/api/create';
    const response = await fetch(momoEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(15000)
    });
    const result = await response.json();

    if (!response.ok || Number(result.resultCode) !== 0 || !result.payUrl) {
        await Order.updateOne(
            { _id: order._id, Status: 'Pending' },
            { $set: { Status: 'Failed' } }
        );
        const error = new Error(result.message || 'MoMo could not create a payment');
        error.statusCode = 502;
        throw error;
    }

    order.PaymentUrl = result.payUrl;
    await order.save();
    return { order, paymentUrl: result.payUrl, alreadyPaid: false };
};

const createVnpayPayment = async (course, accountId, clientIp, Order) => {
    const config = requiredVnpayConfig();
    const order = await Order.create({
        CourseID: course._id,
        AccountID: accountId,
        Amount: course.Fee,
        Currency: 'VND',
        PaymentMethod: 'VNPAY',
        Status: 'Pending'
    });
    const txnRef = order._id.toString();
    const now = new Date();
    const createDate = formatVnpayDate(now);
    const expireDate = formatVnpayDate(new Date(now.getTime() + 15 * 60 * 1000));
    const params = {
        vnp_Version: '2.1.0',
        vnp_Command: 'pay',
        vnp_TmnCode: config.tmnCode,
        vnp_Amount: order.Amount * 100,
        vnp_CurrCode: 'VND',
        vnp_TxnRef: txnRef,
        vnp_OrderInfo: 'Thanh toan khoa hoc IELTS',
        vnp_OrderType: 'other',
        vnp_Locale: 'vn',
        vnp_ReturnUrl: config.returnUrl,
        vnp_ExpireDate: expireDate,
        vnp_IpAddr: getClientIp(clientIp),
        vnp_CreateDate: createDate
    };

    const signData = serializeVnpayParams(params);

    const secureHash = signVnpay(signData, config.hashSecret);

    params.vnp_SecureHash = secureHash;

    const queryString = serializeVnpayParams(params);

    const paymentUrl =
        `${config.paymentUrl}?${queryString}&vnp_SecureHash=${secureHash}`;

    order.VNPayTxnRef = txnRef;
    order.PaymentUrl = paymentUrl;
    await order.save();
    return { order, paymentUrl, alreadyPaid: false };
};

const verifyMomoIpn = async (payload) => {
    const config = requiredMomoConfig();
    const signatureFields = [
        'accessKey',
        'amount',
        'extraData',
        'message',
        'orderId',
        'orderInfo',
        'orderType',
        'partnerCode',
        'payType',
        'requestId',
        'responseTime',
        'resultCode',
        'transId'
    ];
    const rawSignature = signatureFields
        .map((field) => `${field}=${payload[field] ?? ''}`)
        .join('&');
    const expectedSignature = sign(rawSignature, config.secretKey);
    const receivedSignature = typeof payload.signature === 'string' ? payload.signature : '';
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    const receivedBuffer = Buffer.from(receivedSignature, 'hex');

    if (
        expectedBuffer.length !== receivedBuffer.length ||
        !crypto.timingSafeEqual(expectedBuffer, receivedBuffer) ||
        payload.partnerCode !== config.partnerCode
    ) {
        const error = new Error('Invalid MoMo IPN signature');
        error.statusCode = 400;
        throw error;
    }

    const Order = getOrderModel();
    const order = await Order.findOne({
        _id: payload.orderId,
        MomoOrderId: payload.orderId,
        MomoRequestId: payload.requestId,
        PaymentMethod: 'MoMo'
    });
    if (!order || Number(payload.amount) !== order.Amount) {
        const error = new Error('MoMo order or amount does not match');
        error.statusCode = 400;
        throw error;
    }

    if (order.Status === 'Paid') {
        return order;
    }

    const paymentSucceeded = Number(payload.resultCode) === 0;
    const update = {
        Status: paymentSucceeded ? 'Paid' : 'Failed',
        TransactionId: String(payload.transId || '')
    };
    if (paymentSucceeded) update.PaidAt = new Date();

    await Order.updateOne(
        { _id: order._id, Status: 'Pending' },
        { $set: update }
    );
    return Order.findById(order._id);
};

const verifyVnpayCallback = async (payload) => {
    const config = requiredVnpayConfig();
    const providedHash = typeof payload.vnp_SecureHash === 'string'
        ? payload.vnp_SecureHash.toLowerCase()
        : '';
    const signedParams = { ...payload };
    delete signedParams.vnp_SecureHash;
    delete signedParams.vnp_SecureHashType;

    const rawSignature = serializeVnpayParams(signedParams);
    const expectedHash = signVnpay(rawSignature, config.hashSecret);
    const expectedBuffer = Buffer.from(expectedHash, 'hex');
    const providedBuffer = Buffer.from(providedHash, 'hex');
    if (
        !providedHash ||
        expectedBuffer.length !== providedBuffer.length ||
        !crypto.timingSafeEqual(expectedBuffer, providedBuffer) ||
        payload.vnp_TmnCode !== config.tmnCode
    ) {
        const error = new Error('Invalid VNPay signature');
        error.statusCode = 400;
        throw error;
    }

    const Order = getOrderModel();
    const order = await Order.findOne({
        _id: payload.vnp_TxnRef,
        VNPayTxnRef: payload.vnp_TxnRef,
        PaymentMethod: 'VNPAY'
    });
    if (!order || Number(payload.vnp_Amount) !== order.Amount * 100) {
        const error = new Error('VNPay order or amount does not match');
        error.statusCode = 400;
        throw error;
    }

    const paymentSucceeded =
        payload.vnp_ResponseCode === '00' &&
        payload.vnp_TransactionStatus === '00';
    if (order.Status === 'Paid') {
        return order;
    }

    await Order.updateOne(
        { _id: order._id, Status: 'Pending' },
        {
            $set: {
                Status: paymentSucceeded ? 'Paid' : 'Failed',
                TransactionId: String(payload.vnp_TransactionNo || ''),
                ...(paymentSucceeded ? { PaidAt: new Date() } : {})
            }
        }
    );
    return Order.findById(order._id);
};

const processVnpayIpn = async (payload) => {
    try {
        const order = await verifyVnpayCallback(payload);
        if (order.Status === 'Paid') {
            return { RspCode: '00', Message: 'Confirm Success' };
        }
        if (order.Status === 'Failed') {
            return { RspCode: '00', Message: 'Confirm Success' };
        }
        return { RspCode: '99', Message: 'Unknown error' };
    } catch (error) {
        if (error.message === 'Invalid VNPay signature') {
            return { RspCode: '97', Message: 'Invalid signature' };
        }
        if (error.message === 'VNPay order or amount does not match') {
            return { RspCode: '01', Message: 'Order not found' };
        }
        throw error;
    }
};

const getVnpayReturnUrl = () => requiredVnpayConfig().frontendUrl;

const getOrderForAccount = async (orderId, accountId) => {
    const Order = getOrderModel();
    return Order.findOne({ _id: orderId, AccountID: accountId })
        .select('CourseID Amount Currency Status PaymentMethod PaidAt createdAt');
};

const getCourseOrderForAccount = async (courseId, accountId) => {
    const Order = getOrderModel();
    const paidOrder = await Order.findOne({
        CourseID: courseId,
        AccountID: accountId,
        Status: 'Paid'
    }).sort({ createdAt: -1 })
        .select('CourseID Amount Currency Status PaymentMethod PaidAt createdAt');
    if (paidOrder) return paidOrder;

    return Order.findOne({ CourseID: courseId, AccountID: accountId })
        .sort({ createdAt: -1 })
        .select('CourseID Amount Currency Status PaymentMethod PaidAt createdAt');
};

const hasCourseAccess = async (courseId, accountId) => {
    const Order = getOrderModel();
    return Boolean(await Order.exists({
        CourseID: courseId,
        AccountID: accountId,
        Status: 'Paid'
    }));
};

const getMyCourses = async accountId => {
    const Order = getOrderModel();
    const Lesson = getLessonModel();
    const Progress = getLessonProgressModel();
    const orders = await Order.find({ AccountID: accountId, Status: 'Paid' })
        .populate({ path: 'CourseID', match: { IsDeleted: false } })
        .sort({ PaidAt: -1, createdAt: -1 })
        .lean();
    const unique = new Map();
    for (const order of orders) {
        if (order.CourseID?._id && !unique.has(String(order.CourseID._id))) unique.set(String(order.CourseID._id), order);
    }
    return Promise.all([...unique.values()].map(async order => {
        const courseId = order.CourseID._id;
        const [total, completed] = await Promise.all([
            Lesson.countDocuments({ CourseID: courseId, IsDeleted: false, Status: 'Active' }),
            Progress.countDocuments({ CourseID: courseId, UserID: accountId })
        ]);
        return {
            course: order.CourseID,
            order: { _id: order._id, PaidAt: order.PaidAt, createdAt: order.createdAt },
            totalLessons: total,
            completedLessons: completed,
            progressPercent: total ? Math.round((Math.min(completed, total) / total) * 100) : 0
        };
    }));
};

module.exports = {
    createPayment,
    verifyMomoIpn,
    verifyVnpayCallback,
    processVnpayIpn,
    getVnpayReturnUrl,
    getOrderForAccount,
    getCourseOrderForAccount,
    hasCourseAccess,
    getMyCourses
};
