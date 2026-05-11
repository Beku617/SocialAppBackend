const express = require("express");
const { body } = require("express-validator");
const {
  listMyPushTokens,
  registerDevicePushToken,
  unregisterDevicePushToken,
} = require("../controllers/pushController");
const { requireAuth } = require("../middlewares/auth");
const { validateRequest } = require("../utils/validateRequest");

const router = express.Router();

router.get("/tokens", requireAuth, listMyPushTokens);

router.post(
  "/register",
  requireAuth,
  [
    body("token").isString().notEmpty().withMessage("token is required"),
    body("platform")
      .optional()
      .isIn(["ios", "android", "web", "unknown"])
      .withMessage("platform must be ios, android, web, or unknown"),
    body("deviceId")
      .optional({ values: "falsy" })
      .isString()
      .withMessage("deviceId must be a string"),
    body("deviceName")
      .optional({ values: "falsy" })
      .isString()
      .withMessage("deviceName must be a string"),
    body("appVersion")
      .optional({ values: "falsy" })
      .isString()
      .withMessage("appVersion must be a string"),
    validateRequest,
  ],
  registerDevicePushToken,
);

router.post(
  "/unregister",
  requireAuth,
  [
    body("token")
      .optional({ values: "falsy" })
      .isString()
      .withMessage("token must be a string"),
    body("deviceId")
      .optional({ values: "falsy" })
      .isString()
      .withMessage("deviceId must be a string"),
    body().custom((value) => {
      if (value?.token || value?.deviceId) {
        return true;
      }
      throw new Error("Provide token or deviceId");
    }),
    validateRequest,
  ],
  unregisterDevicePushToken,
);

module.exports = router;
