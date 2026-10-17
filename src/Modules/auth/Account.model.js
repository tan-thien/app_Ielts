const mongoose = require('mongoose');
const { getDB } = require('../../config/db_Account');

const schema = new mongoose.Schema({
  Email: String,
  Password: String,
  GoogleID: { type: String, unique: true, sparse: true },
  Role: { type: String, enum: ['user','teacher', 'sensor' ,'admin'], default: 'user' }
});

module.exports = () => {
  const db = getDB();
  return db.models.Account || db.model('Account', schema);
};