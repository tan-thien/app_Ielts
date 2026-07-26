const mongoose = require('mongoose');
const { getDB } = require('../../config/db_Account');

const schema = new mongoose.Schema({
  Email: String,
  Password: String,
  Role: { type: String, enum: ['user','teacher', 'sensor' ,'admin'], default: 'user' }
});

module.exports = () => {return getDB().model('Account', schema);};