const express = require("express");
const { param } = require("express-validator");
const {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  sendTestPush,
} = require("../controllers/notificationController");
const { requireAuth } = require("../middlewares/auth");
const { validateRequest } = require("../utils/validateRequest");

const router = express.Router();

router.get("/", requireAuth, listNotifications);

router.post("/mark-all-read", requireAuth, markAllNotificationsRead);

router.post("/test-push", requireAuth, sendTestPush);

router.post(
  "/:notificationId/read",
  requireAuth,
  [
    param("notificationId").isMongoId().withMessage("Invalid notification id"),
    validateRequest,
  ],
  markNotificationRead,
);

module.exports = router;
