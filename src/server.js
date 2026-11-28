const dotenv = require('dotenv');
const path = require('path');
dotenv.config({
    path: path.resolve(__dirname, '../.env'),
    override: process.env.NODE_ENV !== 'production'
});

const app = require('./app');
const { connectDB, connectDB_LMS, closeDB } = require('./config/db_Account');

const PORT = Number(process.env.PORT) || 3000;
let server = null;
let shutdownPromise = null;

const listen = () => new Promise((resolve, reject) => {
    const listener = app.listen(PORT);
    listener.once('error', reject);
    listener.once('listening', () => {
        listener.removeListener('error', reject);
        resolve(listener);
    });
});

const shutdown = signal => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
        console.log(`[Server] ${signal} received; shutting down.`);
        if (server) {
            await new Promise((resolve, reject) => {
                server.close(error => error ? reject(error) : resolve());
            });
        }
        await closeDB();
        console.log('[Server] Shutdown complete.');
    })().catch(error => {
        console.error(`[Server] Shutdown failed (${error.message}).`);
        process.exitCode = 1;
    });
    return shutdownPromise;
};

process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });

const start = async () => {
    try {
        await connectDB();
        await connectDB_LMS();
        server = await listen();
        console.log(`[Server] Listening on port ${PORT}.`);
    } catch (error) {
        console.error(`[Server] Startup failed (${error.message}).`);
        try {
            await closeDB();
        } catch (closeError) {
            console.error(`[Server] Startup cleanup failed (${closeError.message}).`);
        }
        process.exitCode = 1;
    }
};

void start();
