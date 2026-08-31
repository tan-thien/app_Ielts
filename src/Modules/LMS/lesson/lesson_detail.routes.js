const express = require("express");
const router = express.Router();
const controller = require("./lesson_detail.controller");
const { authenticate } = require("../../../middlewares/auth.middleware");
const { authorize } = require("../../../middlewares/authorize.middleware");

router.post( "/create", authenticate, authorize(["admin"]), controller.createDetail );
router.get( "/get/:id", controller.getDetailById);
router.get( "/lesson/:lessonId", controller.getByLesson );
router.put( "/update/:id", authenticate, authorize(["admin"]), controller.updateDetail );
router.delete( "/delete/:id", authenticate, authorize(["admin"]), controller.deleteDetail);

module.exports = router;