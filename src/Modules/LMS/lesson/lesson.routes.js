const express = require("express");
const router = express.Router();
const controller = require("./lesson.controller");
const { authenticate } = require("../../../middlewares/auth.middleware");
const { authorize } = require("../../../middlewares/authorize.middleware");
const { requirePaidCourse } = require("../Order/course-access.middleware");
const progressController = require("../LessonProgress/lesson-progress.controller");

router.post("/create",authenticate,authorize(['admin']),controller.createLesson);
router.get("/get-all", authenticate, authorize(['admin']), controller.getAllLessons);
router.get("/get/:id", authenticate, requirePaidCourse("lesson", "id"), controller.getLessonById);
router.get("/course/:courseId",controller.getLessonByCourseId);
router.get("/progress/course/:courseId", authenticate, authorize(['user']), progressController.getCourseProgress);
router.get("/activity", authenticate, authorize(['user']), progressController.getStudyActivity);
router.post("/activity/course/:courseId", authenticate, authorize(['user']), progressController.markCourseAccess);
router.post("/progress/:lessonId/complete", authenticate, authorize(['user']), requirePaidCourse("lesson", "lessonId"), progressController.completeLesson);
router.put("/update/:id",authenticate,authorize(['admin']),controller.updateLesson);
router.delete("/delete/:id", authenticate, authorize(["admin"]), controller.deleteLesson);


module.exports = router;
