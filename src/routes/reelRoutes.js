const express = require("express");
const { body, param, query } = require("express-validator");
const {
  completeUpload,
  deleteReel,
  initiateUpload,
  listMyReels,
  listSavedReels,
  listReels,
  markFailed,
  markReady,
  reportReel,
  seedReels,
  toggleLike,
  toggleSave,
  trackView,
  uploadLocalVideo,
  updateReel,
} = require("../controllers/reelController");
const { requireAuth } = require("../middlewares/auth");
const { validateRequest } = require("../utils/validateRequest");

const router = express.Router();

router.get(
  "/",
  requireAuth,
  [
    query("tab")
      .optional()
      .isIn(["reels", "friends"])
      .withMessage("tab must be reels or friends"),
    validateRequest,
  ],
  listReels,
);

router.get("/mine", requireAuth, listMyReels);
router.get("/saved", requireAuth, listSavedReels);

router.post("/seed", requireAuth, seedReels);

router.post(
  "/uploads/initiate",
  requireAuth,
  [
    body("caption")
      .optional({ values: "falsy" })
      .isString()
      .isLength({ max: 2200 })
      .withMessage("caption must be <= 2200 chars"),
    body("music")
      .optional({ values: "falsy" })
      .isString()
      .isLength({ max: 180 })
      .withMessage("music must be <= 180 chars"),
    body("visibility")
      .optional({ values: "falsy" })
      .isIn(["public", "friends", "followers", "private"])
      .withMessage("visibility must be public/friends/private"),
    body("fileName")
      .optional({ values: "falsy" })
      .isString()
      .withMessage("fileName must be a string"),
    body("mimeType")
      .optional({ values: "falsy" })
      .isString()
      .withMessage("mimeType must be a string"),
    validateRequest,
  ],
  initiateUpload,
);

router.post(
  "/:reelId/uploads/complete",
  requireAuth,
  [
    param("reelId").isMongoId().withMessage("Invalid reel id"),
    body("storageKey")
      .optional({ values: "falsy" })
      .isString()
      .withMessage("storageKey must be a string"),
    body("originalUrl")
      .optional({ values: "falsy" })
      .isString()
      .withMessage("originalUrl must be a string"),
    validateRequest,
  ],
  completeUpload,
);

router.post(
  "/:reelId/uploads/local",
  requireAuth,
  [
    param("reelId").isMongoId().withMessage("Invalid reel id"),
    body("base64Data")
      .isString()
      .isLength({ min: 100 })
      .withMessage("base64Data is required"),
    body("mimeType")
      .optional({ values: "falsy" })
      .isString()
      .withMessage("mimeType must be a string"),
    body("fileName")
      .optional({ values: "falsy" })
      .isString()
      .withMessage("fileName must be a string"),
    validateRequest,
  ],
  uploadLocalVideo,
);

router.post(
  "/:reelId/ready",
  requireAuth,
  [
    param("reelId").isMongoId().withMessage("Invalid reel id"),
    body("playbackUrl")
      .trim()
      .isLength({ min: 1 })
      .withMessage("playbackUrl is required"),
    body("thumbUrl")
      .optional({ values: "falsy" })
      .isString()
      .withMessage("thumbUrl must be a string"),
    body("music")
      .optional({ values: "falsy" })
      .isString()
      .isLength({ max: 180 })
      .withMessage("music must be <= 180 chars"),
    body("duration")
      .optional({ values: "falsy" })
      .isFloat({ min: 0 })
      .withMessage("duration must be >= 0"),
    body("width")
      .optional({ values: "falsy" })
      .isInt({ min: 0 })
      .withMessage("width must be >= 0"),
    body("height")
      .optional({ values: "falsy" })
      .isInt({ min: 0 })
      .withMessage("height must be >= 0"),
    validateRequest,
  ],
  markReady,
);

router.post(
  "/:reelId/failed",
  requireAuth,
  [
    param("reelId").isMongoId().withMessage("Invalid reel id"),
    body("failureReason")
      .optional({ values: "falsy" })
      .isString()
      .isLength({ max: 280 })
      .withMessage("failureReason must be <= 280 chars"),
    validateRequest,
  ],
  markFailed,
);

router.patch(
  "/:reelId",
  requireAuth,
  [
    param("reelId").isMongoId().withMessage("Invalid reel id"),
    body("caption")
      .optional()
      .isString()
      .isLength({ max: 2200 })
      .withMessage("caption must be <= 2200 chars"),
    body("music")
      .optional()
      .isString()
      .isLength({ max: 180 })
      .withMessage("music must be <= 180 chars"),
    body("visibility")
      .optional()
      .isIn(["public", "friends", "followers", "private"])
      .withMessage("visibility must be public/friends/private"),
    body("thumbUrl")
      .optional()
      .isString()
      .withMessage("thumbUrl must be a string"),
    validateRequest,
  ],
  updateReel,
);

router.delete(
  "/:reelId",
  requireAuth,
  [param("reelId").isMongoId().withMessage("Invalid reel id"), validateRequest],
  deleteReel,
);

router.post(
  "/:reelId/like",
  requireAuth,
  [param("reelId").isMongoId().withMessage("Invalid reel id"), validateRequest],
  toggleLike,
);

router.post(
  "/:reelId/save",
  requireAuth,
  [param("reelId").isMongoId().withMessage("Invalid reel id"), validateRequest],
  toggleSave,
);

router.post(
  "/:reelId/view",
  requireAuth,
  [param("reelId").isMongoId().withMessage("Invalid reel id"), validateRequest],
  trackView,
);

router.post(
  "/:reelId/report",
  requireAuth,
  [
    param("reelId").isMongoId().withMessage("Invalid reel id"),
    body("reason")
      .optional({ values: "falsy" })
      .isIn([
        "spam",
        "harassment",
        "hate_speech",
        "violence",
        "nudity",
        "false_information",
        "other",
      ])
      .withMessage("Invalid report reason"),
    body("description")
      .optional({ values: "falsy" })
      .isString()
      .isLength({ max: 500 })
      .withMessage("description must be <= 500 chars"),
    validateRequest,
  ],
  reportReel,
);

module.exports = router;
