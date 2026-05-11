const express = require("express");
const { body, param } = require("express-validator");
const {
  addComment,
  createPost,
  deleteComment,
  deletePost,
  getPost,
  getComments,
  listPosts,
  toggleLike,
  seedPosts,
} = require("../controllers/postController");
const { requireAuth } = require("../middlewares/auth");
const { validateRequest } = require("../utils/validateRequest");

const router = express.Router();

router.get("/", listPosts);

// Dev-only seed route
router.post("/seed", seedPosts);

router.get(
  "/:postId",
  requireAuth,
  [param("postId").isMongoId().withMessage("Invalid post id"), validateRequest],
  getPost,
);

router.post(
  "/",
  requireAuth,
  [
    body("text")
      .optional({ values: "falsy" })
      .trim()
      .isLength({ max: 2200 })
      .withMessage("Post text must be at most 2200 chars"),
    body("imageUrl")
      .optional({ values: "falsy" })
      .isString()
      .withMessage("imageUrl must be a string"),
    body("imageUrls")
      .optional({ values: "falsy" })
      .isArray({ max: 10 })
      .withMessage("imageUrls must be an array of strings"),
    body("imageUrls.*")
      .optional({ values: "falsy" })
      .isString()
      .withMessage("imageUrls must contain only strings"),
    body().custom((_, { req }) => {
      const text =
        typeof req.body?.text === "string" ? req.body.text.trim() : "";
      const imageUrl =
        typeof req.body?.imageUrl === "string" ? req.body.imageUrl.trim() : "";
      const imageUrls = Array.isArray(req.body?.imageUrls)
        ? req.body.imageUrls
        : [];
      const hasImagesFromArray = imageUrls.some(
        (url) => typeof url === "string" && url.trim().length > 0,
      );
      if (!text && !imageUrl && !hasImagesFromArray) {
        throw new Error("Post must include text or at least one image");
      }
      return true;
    }),
    validateRequest,
  ],
  createPost,
);

router.post(
  "/:postId/like",
  requireAuth,
  [param("postId").isMongoId().withMessage("Invalid post id"), validateRequest],
  toggleLike,
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
    body("parentCommentId")
      .optional({ values: "falsy" })
      .isMongoId()
      .withMessage("Invalid parent comment id"),
    body("mentions")
      .optional({ values: "falsy" })
      .isArray({ max: 20 })
      .withMessage("mentions must be an array"),
    body("mentions.*.userId")
      .optional()
      .isMongoId()
      .withMessage("Invalid mention user id"),
    body("mentions.*.name")
      .optional()
      .isString()
      .trim()
      .isLength({ min: 1, max: 60 })
      .withMessage("Invalid mention name"),
    body("mentions.*.start")
      .optional()
      .isInt({ min: 0, max: 500 })
      .withMessage("Invalid mention start"),
    body("mentions.*.end")
      .optional()
      .isInt({ min: 1, max: 500 })
      .withMessage("Invalid mention end"),
    validateRequest,
  ],
  addComment,
);

router.get(
  "/:postId/comments",
  requireAuth,
  [param("postId").isMongoId().withMessage("Invalid post id"), validateRequest],
  getComments,
);

router.delete(
  "/:postId/comments/:commentId",
  requireAuth,
  [
    param("postId").isMongoId().withMessage("Invalid post id"),
    param("commentId").isMongoId().withMessage("Invalid comment id"),
    validateRequest,
  ],
  deleteComment,
);

router.delete(
  "/:postId",
  requireAuth,
  [param("postId").isMongoId().withMessage("Invalid post id"), validateRequest],
  deletePost,
);

module.exports = router;
