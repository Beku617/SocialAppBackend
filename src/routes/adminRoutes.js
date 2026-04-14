const express = require("express");
const { body, param } = require("express-validator");
const {
  banUser,
  blockPostEdit,
  blockReelEdit,
  createAdminPost,
  createAdminReel,
  deleteAdminPost,
  deleteAdminReel,
  deleteUser,
  dismissReelReport,
  getPostDetails,
  getReelDetails,
  getSummary,
  getUserDetails,
  hideReelFromReport,
  listPosts,
  listReelReports,
  listReports,
  listReels,
  listUsers,
  sendAdminNotification,
  unbanUser,
} = require("../controllers/adminController");
const { requireAuth, requireAdmin } = require("../middlewares/auth");
const { validateRequest } = require("../utils/validateRequest");

const router = express.Router();

router.use(requireAuth, requireAdmin);

router.get("/summary", getSummary);
router.post(
  "/notifications",
  [
    body("title")
      .trim()
      .isLength({ min: 1, max: 180 })
      .withMessage("title is required (max 180 chars)"),
    body("body")
      .trim()
      .isLength({ min: 1, max: 500 })
      .withMessage("body is required (max 500 chars)"),
    body("allUsers")
      .optional()
      .isBoolean()
      .withMessage("allUsers must be boolean"),
    body("userIds")
      .optional()
      .isArray({ min: 1, max: 1000 })
      .withMessage("userIds must be a non-empty array"),
    body("userIds.*")
      .optional()
      .isMongoId()
      .withMessage("Each userId must be valid"),
    validateRequest,
  ],
  sendAdminNotification,
);

router.get("/users", listUsers);
router.get(
  "/users/:userId",
  [param("userId").isMongoId().withMessage("Invalid user id"), validateRequest],
  getUserDetails,
);
router.post(
  "/users/:userId/ban",
  [
    param("userId").isMongoId().withMessage("Invalid user id"),
    body("duration")
      .isIn(["1d", "3d", "7d", "30d", "forever"])
      .withMessage("Invalid ban duration"),
    validateRequest,
  ],
  banUser,
);
router.post(
  "/users/:userId/unban",
  [param("userId").isMongoId().withMessage("Invalid user id"), validateRequest],
  unbanUser,
);
router.delete(
  "/users/:userId",
  [param("userId").isMongoId().withMessage("Invalid user id"), validateRequest],
  deleteUser,
);

router.get("/reports", listReports);
router.get("/reel-reports", listReelReports);
router.patch(
  "/reel-reports/:reportId/dismiss",
  [param("reportId").isMongoId().withMessage("Invalid report id"), validateRequest],
  dismissReelReport,
);
router.patch(
  "/reel-reports/:reportId/hide-reel",
  [param("reportId").isMongoId().withMessage("Invalid report id"), validateRequest],
  hideReelFromReport,
);

router.get("/posts", listPosts);
router.get(
  "/posts/:postId",
  [param("postId").isMongoId().withMessage("Invalid post id"), validateRequest],
  getPostDetails,
);
router.post(
  "/posts",
  [
    body("text")
      .optional()
      .isString()
      .isLength({ max: 2200 })
      .withMessage("Post text must be 2200 chars or fewer"),
    body("imageUrl")
      .optional({ values: "falsy" })
      .isString()
      .withMessage("imageUrl must be a string"),
    body("imageUrls")
      .optional()
      .isArray({ max: 10 })
      .withMessage("imageUrls must be an array of up to 10 items"),
    body("imageUrls.*")
      .optional()
      .isString()
      .withMessage("Each imageUrls entry must be a string"),
    body().custom((_value, { req }) => {
      const text =
        typeof req.body.text === "string" ? req.body.text.trim() : "";
      const hasImageUrl =
        typeof req.body.imageUrl === "string" &&
        req.body.imageUrl.trim().length > 0;
      const hasImageUrls =
        Array.isArray(req.body.imageUrls) &&
        req.body.imageUrls.some(
          (imageUrl) =>
            typeof imageUrl === "string" && imageUrl.trim().length > 0,
        );

      if (!text && !hasImageUrl && !hasImageUrls) {
        throw new Error("Post must include text or at least one image");
      }

      return true;
    }),
    validateRequest,
  ],
  createAdminPost,
);
router.delete(
  "/posts/:postId",
  [param("postId").isMongoId().withMessage("Invalid post id"), validateRequest],
  deleteAdminPost,
);
router.put(
  "/posts/:postId",
  [param("postId").isMongoId().withMessage("Invalid post id"), validateRequest],
  blockPostEdit,
);
router.patch(
  "/posts/:postId",
  [param("postId").isMongoId().withMessage("Invalid post id"), validateRequest],
  blockPostEdit,
);

router.get("/reels", listReels);
router.get(
  "/reels/:reelId",
  [param("reelId").isMongoId().withMessage("Invalid reel id"), validateRequest],
  getReelDetails,
);
router.post(
  "/reels",
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
    body("thumbUrl")
      .optional({ values: "falsy" })
      .isString()
      .withMessage("thumbUrl must be a string"),
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
  createAdminReel,
);
router.delete(
  "/reels/:reelId",
  [param("reelId").isMongoId().withMessage("Invalid reel id"), validateRequest],
  deleteAdminReel,
);
router.put(
  "/reels/:reelId",
  [param("reelId").isMongoId().withMessage("Invalid reel id"), validateRequest],
  blockReelEdit,
);
router.patch(
  "/reels/:reelId",
  [param("reelId").isMongoId().withMessage("Invalid reel id"), validateRequest],
  blockReelEdit,
);

module.exports = router;
