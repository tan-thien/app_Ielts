const mongoose = require('mongoose');

let connection = null;
let connection_LMS = null;

const connectDB = async () => {
  try {
    connection = mongoose.createConnection(process.env.MONGO_URI_ACC);

    connection.on('connected', () => {console.log('MongoDB connected');});
    
    connection.on('error', (err) => {console.log(err);});
    
  } catch (err) 
  {
    console.log(err);
  }
};

const connectDB_LMS = async () => {
  try {
    connection_LMS = mongoose.createConnection(process.env.MONGO_URI_LMS);

    connection_LMS.on('connected', () => {console.log('MongoDB LMS connected');});
    
    connection_LMS.on('error', (err) => {console.log(err);});
    
  } catch (err) 
  {
    console.log(err);
  }
};

const getDB = () => connection;
const getDB_LMS = () => connection_LMS;

module.exports = { connectDB, connectDB_LMS, getDB, getDB_LMS };