const express = require("express");
const { body, param, query } = require("express-validator");
const multer = require("multer");
const { env } = require("../config/env");
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
  signUpload,
  toggleLike,
  toggleSave,
  trackView,
  uploadLocalVideo,
  updateReel,
} = require("../controllers/reelController");
const { requireAuth } = require("../middlewares/auth");
const { validateRequest } = require("../utils/validateRequest");
const { REEL_VISIBILITY_VALUES } = require("../utils/visibility");

const router = express.Router();
const reelVideoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024 },
});
const applyUploadTimeout = (req, res, next) => {
  req.setTimeout(env.REELS_UPLOAD_TIMEOUT_MS);
  res.setTimeout(env.REELS_UPLOAD_TIMEOUT_MS);
  next();
};

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
      .isIn(REEL_VISIBILITY_VALUES)
      .withMessage("visibility must be public/friends/private"),
    validateRequest,
  ],
  initiateUpload,
);

router.post(
  "/uploads/sign",
  requireAuth,
  [
    body("reelId").isMongoId().withMessage("Invalid reel id"),
    validateRequest,
  ],
  signUpload,
);

const completeUploadValidators = [
  param("reelId").isMongoId().withMessage("Invalid reel id"),
  validateRequest,
];

router.post("/:reelId/complete", requireAuth, completeUploadValidators, completeUpload);

router.post(
  "/:reelId/uploads/complete",
  requireAuth,
  completeUploadValidators,
  completeUpload,
);

router.post(
  "/:reelId/uploads/local",
  requireAuth,
  applyUploadTimeout,
  reelVideoUpload.single("video"),
  [
    param("reelId").isMongoId().withMessage("Invalid reel id"),
    body().custom((_, { req }) => {
      const hasMultipartVideo = Boolean(req.file?.buffer?.length);
      const base64Data = typeof req.body?.base64Data === "string"
        ? req.body.base64Data.trim()
        : "";
      if (!hasMultipartVideo && base64Data.length < 100) {
        throw new Error("Provide either multipart video file or base64Data");
      }
      return true;
    }),
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
      .isIn(REEL_VISIBILITY_VALUES)
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
