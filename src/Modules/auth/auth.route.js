const express = require('express');
const router = express.Router();
const controller = require('./auth.controller');
const { authenticate } = require('../../middlewares/auth.middleware');

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register account
 *     tags: [Auth]
 */
router.post('/register', controller.register);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login account
 *     tags: [Auth]
 */
router.post('/login', controller.login);
router.post('/forgot-password', controller.requestPasswordReset);
router.post('/reset-password', controller.resetPassword);
router.post('/google', controller.googleLogin);
router.post('/google/complete-registration', controller.completeGoogleRegistration);
router.get("/me", authenticate, controller.getMe);
router.put('/me', authenticate, controller.updateMe);
router.get('/user/:userId', authenticate, controller.getUserById);

module.exports = router;
