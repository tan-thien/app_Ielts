const express = require('express');
const router = express.Router();
const { createAssignmentController, updateAssignmentController, getAssignmentController, 
        getCourseAssignmentsController, getAssignmentByIdController, deleteAssignmentController,
        getReadingListeningPracticeAssignmentsController, getReadingListeningPracticeReviewController } = require('./assignment.controller');
const { authenticate } = require('../../../middlewares/auth.middleware');
const { authorize } = require('../../../middlewares/authorize.middleware');
const { requirePaidCourse } = require('../Order/course-access.middleware');

router.post('/create', authenticate, authorize(['admin']), createAssignmentController);
router.put('/update/:id', authenticate, authorize(['admin']), updateAssignmentController);
router.get('/practice-center', authenticate, authorize(['user']), getReadingListeningPracticeAssignmentsController);
router.get(
    '/practice-center/:assignmentId/review/:submissionId',
    authenticate,
    authorize(['user']),
    getReadingListeningPracticeReviewController
);
router.get('/course/:courseId', authenticate, authorize(['user']), requirePaidCourse('course', 'courseId'), getCourseAssignmentsController);
router.get('/get/:id', authenticate, requirePaidCourse('assignment', 'id'), getAssignmentByIdController);
router.delete('/delete/:id', authenticate, authorize(['admin']), deleteAssignmentController);
router.get('/get-all', authenticate, authorize(['admin', 'teacher']), getAssignmentController);

module.exports = router;
