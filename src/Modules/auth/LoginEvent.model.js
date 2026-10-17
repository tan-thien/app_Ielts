const mongoose = require('mongoose');
const { getDB } = require('../../config/db_Account');

const schema = new mongoose.Schema({
    AccountID: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    LoggedInAt: { type: Date, default: Date.now, required: true }
});

schema.index({ LoggedInAt: 1 });
schema.index({ AccountID: 1, LoggedInAt: -1 });

module.exports = () => {
    const db = getDB();
    return db.models.LoginEvent || db.model('LoginEvent', schema);
};
