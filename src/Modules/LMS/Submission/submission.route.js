const express = require('express');
const router = express.Router();
const { createSubmissionController, getAllSubmissionsController, getSubmissionByIdController, getSubmissionByAssignmentController, getSubmissionByUserController, getSubmissionByMeController, updateSubmissionController, submitAssignmentController, reviewAIController, reviewTeacherController, updateScoreController, deleteSubmissionController } = require('./submission.controller');
const { authenticate } = require('../../../middlewares/auth.middleware');
const { authorize } = require('../../../middlewares/authorize.middleware');

router.post('/create', authenticate, createSubmissionController);
router.get('/get-all', authenticate, authorize(['admin']), getAllSubmissionsController);
router.get('/detail/:id', authenticate, getSubmissionByIdController);
router.get('/assignment/:id', authenticate, authorize(['teacher', 'admin']), getSubmissionByAssignmentController);
router.get('/user/:id', authenticate, authorize(['admin']), getSubmissionByUserController);
router.get('/my', authenticate, getSubmissionByMeController);
router.put('/update/:id', authenticate, updateSubmissionController);
router.put('/submit/:id', authenticate, submitAssignmentController);
router.put('/review-ai/:id', authenticate, authorize(['teacher', 'admin']), reviewAIController);
router.put('/review-teacher/:id', authenticate, authorize(['teacher', 'admin']), reviewTeacherController);
router.put('/score/:id', authenticate, authorize(['teacher', 'admin']), updateScoreController);
router.delete('/delete/:id', authenticate, authorize(['admin']), deleteSubmissionController);

module.exports = router;
