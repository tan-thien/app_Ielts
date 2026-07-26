const express = require('express');
const router = express.Router();
const { createAssignmentController, updateAssignmentController, getAssignmentController, getAssignmentByIdController, deleteAssignmentController } = require('./assignment.controller');
const { authenticate } = require('../../../middlewares/auth.middleware');
const { authorize } = require('../../../middlewares/authorize.middleware');

router.post('/create', authenticate, authorize(['admin']), createAssignmentController);
router.put('/update/:id', authenticate, authorize(['admin']), updateAssignmentController);
router.get('/get/:id', authenticate, getAssignmentByIdController);
router.delete('/delete/:id', authenticate, authorize(['admin']), deleteAssignmentController);
router.get('/get-all', authenticate, getAssignmentController);

module.exports = router;
