const mongoose = require('mongoose');

let connection = null;
let connection_LMS = null;
let accountConnectionPromise = null;
let lmsConnectionPromise = null;

const openConnection = async (label, uri) => {
    if (!uri) throw new Error(`${label} database URI is not configured`);
    let dbConnection;
    try {
        dbConnection = mongoose.createConnection(uri, { serverSelectionTimeoutMS: 10000 });
        dbConnection.on('error', () => {
            console.error(`[Database] ${label} connection error.`);
        });
        await dbConnection.asPromise();
        console.log(`[Database] ${label} connected.`);
        return dbConnection;
    } catch (error) {
        if (dbConnection) {
            await dbConnection.close().catch(() => {
                console.error(`[Database] Could not close the failed ${label} connection.`);
            });
        }
        throw new Error(`${label} database connection failed (${error.name || 'Error'}).`);
    }
};

const connectDB = () => {
    if (connection?.readyState === 1) return Promise.resolve(connection);
    if (accountConnectionPromise) return accountConnectionPromise;
    accountConnectionPromise = openConnection('Account', process.env.MONGO_URI_ACC)
        .then(dbConnection => {
            connection = dbConnection;
            return dbConnection;
        })
        .finally(() => {
            accountConnectionPromise = null;
        });
    return accountConnectionPromise;
};

const connectDB_LMS = () => {
    if (connection_LMS?.readyState === 1) return Promise.resolve(connection_LMS);
    if (lmsConnectionPromise) return lmsConnectionPromise;
    lmsConnectionPromise = openConnection('LMS', process.env.MONGO_URI_LMS)
        .then(dbConnection => {
            connection_LMS = dbConnection;
            return dbConnection;
        })
        .finally(() => {
            lmsConnectionPromise = null;
        });
    return lmsConnectionPromise;
};

const closeDB = async () => {
    const connections = [connection, connection_LMS].filter(Boolean);
    connection = null;
    connection_LMS = null;
    const results = await Promise.allSettled(connections.map(dbConnection => dbConnection.close()));
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) {
        throw new Error(`Failed to close ${failures.length} database connection(s).`);
    }
};

const getDB = () => connection;
const getDB_LMS = () => connection_LMS;

module.exports = { connectDB, connectDB_LMS, closeDB, getDB, getDB_LMS };
