const express = require("express");
const router = express.Router();
const controller = require("./lesson_detail.controller");
const { authenticate } = require("../../../middlewares/auth.middleware");
const { authorize } = require("../../../middlewares/authorize.middleware");
const { requirePaidCourse } = require("../Order/course-access.middleware");

router.post( "/create", authenticate, authorize(["admin"]), controller.createDetail );
router.get( "/get/:id", authenticate, requirePaidCourse("detail", "id"), controller.getDetailById);
router.get( "/lesson/:lessonId", authenticate, requirePaidCourse("lesson", "lessonId"), controller.getByLesson );
router.put( "/lesson/:lessonId/reorder", authenticate, authorize(["admin"]), controller.reorderDetails );
router.put( "/update/:id", authenticate, authorize(["admin"]), controller.updateDetail );
router.delete( "/delete/:id", authenticate, authorize(["admin"]), controller.deleteDetail);

module.exports = router;