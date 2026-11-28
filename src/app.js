const dotenv = require('dotenv');
const path = require('path');
dotenv.config({
    path: path.resolve(__dirname, '../.env'),
    override: process.env.NODE_ENV !== 'production'
});

const express = require('express');
const cors = require('cors');
const routes = require('./routes/index');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');

const app = express();

const normalizeOrigin = value => {
    try {
        return new URL(value).origin;
    } catch {
        return '';
    }
};
const allowedOrigins = new Set(
    [
        process.env.FRONTEND_URL,
        ...(process.env.CORS_ORIGINS || '').split(','),
        ...(process.env.NODE_ENV !== 'production'
            ? ['http://localhost:5173', 'http://127.0.0.1:5173']
            : [])
    ]
        .map(value => normalizeOrigin((value || '').trim()))
        .filter(Boolean)
);
const corsOptions = {
    origin(origin, callback) {
        if (!origin || (process.env.NODE_ENV !== 'production' && allowedOrigins.size === 0)) {
            return callback(null, true);
        }
        return callback(null, allowedOrigins.has(normalizeOrigin(origin)));
    }
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api', routes);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.get('/', (req, res) => { res.send('Welcome to the IELTS App API');});

module.exports = app;
