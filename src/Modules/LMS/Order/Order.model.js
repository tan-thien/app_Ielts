const mongoose = require('mongoose');
const { getDB_LMS } = require('../../../config/db_Account');

const orderSchema = new mongoose.Schema(
    {
        CourseID: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Course',
            required: true
        },
        AccountID: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Account',
            required: true
        },
        Amount: {
            type: Number,
            required: true,
            min: 0
        },
        Currency: {
            type: String,
            default: 'VND'
        },
        Status: {
            type: String,
            enum: ['Pending', 'Paid', 'Failed'],
            default: 'Pending'
        },
        PaymentMethod: {
            type: String,
            enum: ['MoMo', 'VNPAY', 'Free'],
            required: true
        },
        MomoOrderId: {
            type: String,
            unique: true,
            sparse: true
        },
        MomoRequestId: String,
        VNPayTxnRef: String,
        PaymentUrl: String,
        TransactionId: String,
        PaidAt: Date
    },
    { timestamps: true }
);

orderSchema.index({ AccountID: 1, CourseID: 1, Status: 1 });

module.exports = () => {
    const db = getDB_LMS();
    return db.models.Order || db.model('Order', orderSchema);
};
