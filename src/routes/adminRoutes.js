const express = require("express");
const { body, param, query } = require("express-validator");
const {
  ADMIN_NOTIFICATION_CATEGORIES,
  getAdminSession,
  getDashboardOverview,
  getNotificationSettings,
  getUserDetail,
  listAuditLogs,
  listNotificationHistory,
  listUsers,
  loginAdmin,
  sendAdminMessagePushTest,
  sendNotificationToAllUsers,
  sendNotificationToSelectedUsers,
  sendNotificationToSingleUser,
  updateNotificationSettings,
  updateUserStatus,
} = require("../controllers/adminController");
const { requireAdmin, requireAuth } = require("../middlewares/auth");
const { ALLOWED_NOTIFICATION_FIELDS } = require("../utils/notificationPreferences");
const { USER_ACCOUNT_STATUSES } = require("../utils/userAccountStatus");
const { validateRequest } = require("../utils/validateRequest");

const router = express.Router();

const notificationSettingsValidation = ALLOWED_NOTIFICATION_FIELDS.map((field) =>
  body(field)
    .optional()
    .isBoolean()
    .withMessage(`${field} must be true or false`),
);

const adminNotificationPayloadValidation = [
  body("title")
    .trim()
    .isLength({ min: 1, max: 80 })
    .withMessage("Title must be 1-80 characters"),
  body("body")
    .trim()
    .isLength({ min: 1, max: 280 })
    .withMessage("Body must be 1-280 characters"),
  body("category")
    .optional({ values: "falsy" })
    .isIn(ADMIN_NOTIFICATION_CATEGORIES)
    .withMessage(`category must be one of: ${ADMIN_NOTIFICATION_CATEGORIES.join(", ")}`),
  body("deepLink")
    .optional({ values: "falsy" })
    .isString()
    .isLength({ max: 160 })
    .withMessage("deepLink must be 160 characters or fewer"),
  body("deepLink")
    .optional({ values: "falsy" })
    .custom((value) => typeof value === "string" && value.trim().startsWith("/"))
    .withMessage("deepLink must start with /"),
  body("sendPush")
    .optional()
    .isBoolean()
    .withMessage("sendPush must be true or false"),
  body("clientRequestId")
    .optional({ values: "falsy" })
    .isString()
    .isLength({ min: 8, max: 120 })
    .withMessage("clientRequestId must be 8-120 characters"),
];

router.post(
  "/login",
  [
    body("email").trim().isEmail().withMessage("Provide a valid admin email"),
    body("password").isString().notEmpty().withMessage("Password is required"),
    validateRequest,
  ],
  loginAdmin,
);

router.get("/me", requireAuth, requireAdmin, getAdminSession);

router.get("/dashboard/overview", requireAuth, requireAdmin, getDashboardOverview);

router.get(
  "/users",
  requireAuth,
  requireAdmin,
  [
    query("page").optional().isInt({ min: 1 }).withMessage("page must be >= 1"),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 50 })
      .withMessage("limit must be between 1 and 50"),
    query("role")
      .optional({ values: "falsy" })
      .isIn(["user", "admin"])
      .withMessage("role must be user or admin"),
    query("status")
      .optional({ values: "falsy" })
      .isIn(USER_ACCOUNT_STATUSES)
      .withMessage(`status must be one of: ${USER_ACCOUNT_STATUSES.join(", ")}`),
    query("recent")
      .optional({ values: "falsy" })
      .isIn(["7d", "30d"])
      .withMessage("recent must be 7d or 30d"),
    validateRequest,
  ],
  listUsers,
);

router.get(
  "/users/:id",
  requireAuth,
  requireAdmin,
  [param("id").isMongoId().withMessage("Invalid user id"), validateRequest],
  getUserDetail,
);

router.patch(
  "/users/:id/status",
  requireAuth,
  requireAdmin,
  [
    param("id").isMongoId().withMessage("Invalid user id"),
    body("status")
      .isIn(USER_ACCOUNT_STATUSES)
      .withMessage(`status must be one of: ${USER_ACCOUNT_STATUSES.join(", ")}`),
    body("reason")
      .optional({ values: "falsy" })
      .isString()
      .isLength({ max: 240 })
      .withMessage("reason must be 240 characters or fewer"),
    validateRequest,
  ],
  updateUserStatus,
);

router.get("/notification-settings", requireAuth, requireAdmin, getNotificationSettings);

router.patch(
  "/notification-settings",
  requireAuth,
  requireAdmin,
  [...notificationSettingsValidation, validateRequest],
  updateNotificationSettings,
);

router.post(
  "/notification-settings/test-message",
  requireAuth,
  requireAdmin,
  [
    body("userId")
      .optional({ values: "falsy" })
      .isMongoId()
      .withMessage("userId must be a valid user id"),
    validateRequest,
  ],
  sendAdminMessagePushTest,
);

router.get(
  "/notifications/history",
  requireAuth,
  requireAdmin,
  [
    query("page").optional().isInt({ min: 1 }).withMessage("page must be >= 1"),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 50 })
      .withMessage("limit must be between 1 and 50"),
    validateRequest,
  ],
  listNotificationHistory,
);

router.get(
  "/audit-logs",
  requireAuth,
  requireAdmin,
  [
    query("page").optional().isInt({ min: 1 }).withMessage("page must be >= 1"),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 50 })
      .withMessage("limit must be between 1 and 50"),
    validateRequest,
  ],
  listAuditLogs,
);

router.post(
  "/notifications/send",
  requireAuth,
  requireAdmin,
  [
    body("userId").isMongoId().withMessage("userId must be a valid user id"),
    ...adminNotificationPayloadValidation,
    validateRequest,
  ],
  sendNotificationToSingleUser,
);

router.post(
  "/notifications/send-bulk",
  requireAuth,
  requireAdmin,
  [
    body("userIds")
      .isArray({ min: 1, max: 500 })
      .withMessage("userIds must contain 1-500 user ids"),
    body("userIds.*").isMongoId().withMessage("Each userId must be valid"),
    ...adminNotificationPayloadValidation,
    validateRequest,
  ],
  sendNotificationToSelectedUsers,
);

router.post(
  "/notifications/send-all",
  requireAuth,
  requireAdmin,
  [
    body("confirmAllUsers")
      .custom((value) => value === true)
      .withMessage("confirmAllUsers must be true"),
    ...adminNotificationPayloadValidation,
    validateRequest,
  ],
  sendNotificationToAllUsers,
);

module.exports = router;
