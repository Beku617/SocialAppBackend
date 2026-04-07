const express = require("express");
const { body, param } = require("express-validator");
const {
  addComment,
  createPost,
  deletePost,
  getPost,
  listPosts,
  reportPost,
  sharePost,
  toggleLike,
  togglePostNotifications,
  updatePost,
  seedPosts,
} = require("../controllers/postController");
const { requireAuth } = require("../middlewares/auth");
const { validateRequest } = require("../utils/validateRequest");

const router = express.Router();

router.get("/", requireAuth, listPosts);
router.get(
  "/:postId",
  requireAuth,
  [param("postId").isMongoId().withMessage("Invalid post id"), validateRequest],
  getPost,
);

// Dev-only seed route
router.post("/seed", seedPosts);

router.post(
  "/",
  requireAuth,
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
    body("visibility")
      .optional({ values: "falsy" })
      .isIn(["public", "friends", "private"])
      .withMessage("visibility must be public/friends/private"),
    body().custom((_value, { req }) => {
      const text =
        typeof req.body.text === "string" ? req.body.text.trim() : "";
      const hasImageUrl =
        typeof req.body.imageUrl === "string" && req.body.imageUrl.trim().length > 0;
      const hasImageUrls =
        Array.isArray(req.body.imageUrls) &&
        req.body.imageUrls.some(
          (imageUrl) => typeof imageUrl === "string" && imageUrl.trim().length > 0,
        );

      if (!text && !hasImageUrl && !hasImageUrls) {
        throw new Error("Post must include text or at least one image");
      }

      return true;
    }),
    validateRequest,
  ],
  createPost,
);

router.put(
  "/:postId",
  requireAuth,
  [
    param("postId").isMongoId().withMessage("Invalid post id"),
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
    body("visibility")
      .optional({ values: "falsy" })
      .isIn(["public", "friends", "private"])
      .withMessage("visibility must be public/friends/private"),
    body().custom((_value, { req }) => {
      const text =
        typeof req.body.text === "string" ? req.body.text.trim() : "";
      const hasImageUrl =
        typeof req.body.imageUrl === "string" && req.body.imageUrl.trim().length > 0;
      const hasImageUrls =
        Array.isArray(req.body.imageUrls) &&
        req.body.imageUrls.some(
          (imageUrl) => typeof imageUrl === "string" && imageUrl.trim().length > 0,
        );

      if (!text && !hasImageUrl && !hasImageUrls) {
        throw new Error("Post must include text or at least one image");
      }

      return true;
    }),
    validateRequest,
  ],
  updatePost,
);

router.post(
  "/:postId/share",
  requireAuth,
  [
    param("postId").isMongoId().withMessage("Invalid post id"),
    body("text")
      .optional()
      .isString()
      .isLength({ max: 2200 })
      .withMessage("Share caption must be 2200 chars or fewer"),
    body("visibility")
      .optional({ values: "falsy" })
      .isIn(["public", "friends", "private"])
      .withMessage("visibility must be public/friends/private"),
    validateRequest,
  ],
  sharePost,
);

router.post(
  "/:postId/like",
  requireAuth,
  [param("postId").isMongoId().withMessage("Invalid post id"), validateRequest],
  toggleLike,
);

router.post(
  "/:postId/notifications/toggle",
  requireAuth,
  [param("postId").isMongoId().withMessage("Invalid post id"), validateRequest],
  togglePostNotifications,
);

router.post(
  "/:postId/comments",
  requireAuth,
  [
    param("postId").isMongoId().withMessage("Invalid post id"),
    body("text")
      .trim()
      .isLength({ min: 1, max: 500 })
      .withMessage("Comment must be 1-500 chars"),
    validateRequest,
  ],
  addComment,
);

router.post(
  "/:postId/report",
  requireAuth,
  [
    param("postId").isMongoId().withMessage("Invalid post id"),
    body("reason")
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
      .optional()
      .isString()
      .isLength({ max: 500 })
      .withMessage("Description must be up to 500 chars"),
    validateRequest,
  ],
  reportPost,
);

router.delete(
  "/:postId",
  requireAuth,
  [param("postId").isMongoId().withMessage("Invalid post id"), validateRequest],
  deletePost,
);

module.exports = router;
