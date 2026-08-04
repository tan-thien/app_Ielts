const express = require("express");
const router = express.Router();
const controller = require("./lesson.controller");
const { authenticate } = require("../../../middlewares/auth.middleware");
const { authorize } = require("../../../middlewares/authorize.middleware");

router.post("/create",authenticate,authorize(['admin']),controller.createLesson);
router.get("/get-all",controller.getAllLessons);
router.get("/get/:id",controller.getLessonById);
router.get("/course/:courseId",controller.getLessonByCourseId);
router.put("/update/:id",authenticate,authorize(['admin']),controller.updateLesson);
router.delete("/delete/:id", authenticate, authorize(["admin"]), controller.deleteLesson);


module.exports = router;