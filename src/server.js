const app = require('./app');
const dotenv = require('dotenv');
const { connectDB } = require('./config/db_Account'); 
const { connectDB_LMS } = require('./config/db_Account');

dotenv.config();

const PORT = process.env.PORT || 3000;

const start = async () => {
    await connectDB(); 
    await connectDB_LMS();
    app.listen(PORT, () => {
        console.log(`Server is running on port localhost:${PORT}`);
    });
};

start();