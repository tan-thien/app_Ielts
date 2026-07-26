const mongoose = require('mongoose');
const { getDB } = require('../../config/db_Account');

const schema = new mongoose.Schema({
    AccountID: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' }, 
    Name: String,
    Gender: { type: String, enum: ['male', 'female', 'other'] },
    Address: String,
    Phone: String,
    Birthday: Date,
    Avatar : String,
    
});

module.exports = () => {return getDB().model('Account_Detail', schema);};