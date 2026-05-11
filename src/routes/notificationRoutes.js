const express = require("express");
const { param } = require("express-validator");
const {
  getUnreadNotificationsCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} = require("../controllers/notificationController");
const { requireAuth } = require("../middlewares/auth");
const { validateRequest } = require("../utils/validateRequest");

const router = express.Router();

router.get("/", requireAuth, listNotifications);
router.get("/unread-count", requireAuth, getUnreadNotificationsCount);

router.patch("/read-all", requireAuth, markAllNotificationsRead);

router.patch(
  "/:id/read",
  requireAuth,
  [param("id").isMongoId().withMessage("Invalid notification id"), validateRequest],
  markNotificationRead,
);

module.exports = router;
