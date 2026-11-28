const express = require('express');
const { authenticate } = require('../../middlewares/auth.middleware');
const controller = require('./mistake-notebook.controller');

const router = express.Router();
router.use(authenticate);
router.get('/sources', controller.sources);
router.post('/import/:submissionId', controller.importSubmission);
router.get('/', controller.list);
router.patch('/:id', controller.update);
router.post('/:id/reviews', controller.review);
router.delete('/:id', controller.remove);

module.exports = router;
