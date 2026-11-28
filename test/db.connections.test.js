const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

test('database connections are exposed only after they are ready and can be closed cleanly', async context => {
    const originalCreateConnection = mongoose.createConnection;
    const originalAccountUri = process.env.MONGO_URI_ACC;
    const originalLmsUri = process.env.MONGO_URI_LMS;
    const modulePath = require.resolve('../src/config/db_Account');
    const connections = [];
    mongoose.createConnection = () => {
        let resolveReady;
        const ready = new Promise(resolve => { resolveReady = resolve; });
        const connection = {
            readyState: 2,
            on() { return this; },
            asPromise() {
                return ready.then(() => {
                    this.readyState = 1;
                    return this;
                });
            },
            markReady() { resolveReady(); },
            async close() { this.readyState = 0; }
        };
        connections.push(connection);
        return connection;
    };
    process.env.MONGO_URI_ACC = 'mongodb://account.test.invalid';
    process.env.MONGO_URI_LMS = 'mongodb://lms.test.invalid';
    delete require.cache[modulePath];
    const database = require('../src/config/db_Account');

    context.after(() => {
        mongoose.createConnection = originalCreateConnection;
        if (originalAccountUri === undefined) delete process.env.MONGO_URI_ACC;
        else process.env.MONGO_URI_ACC = originalAccountUri;
        if (originalLmsUri === undefined) delete process.env.MONGO_URI_LMS;
        else process.env.MONGO_URI_LMS = originalLmsUri;
        delete require.cache[modulePath];
    });

    const accountPromise = database.connectDB();
    assert.equal(database.getDB(), null);
    connections[0].markReady();
    await accountPromise;
    assert.equal(database.getDB(), connections[0]);

    const lmsPromise = database.connectDB_LMS();
    assert.equal(database.getDB_LMS(), null);
    connections[1].markReady();
    await lmsPromise;
    assert.equal(database.getDB_LMS(), connections[1]);

    await database.closeDB();
    assert.equal(database.getDB(), null);
    assert.equal(database.getDB_LMS(), null);
    assert.equal(connections[0].readyState, 0);
    assert.equal(connections[1].readyState, 0);
});
