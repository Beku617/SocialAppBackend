const express = require("express");
const { body, param } = require("express-validator");
const {
  getComments,
  addComment,
  likeComment,
  dislikeComment,
  deleteComment,
} = require("../controllers/reelCommentController");
const { requireAuth } = require("../middlewares/auth");
const { validateRequest } = require("../utils/validateRequest");

const router = express.Router();

// GET /api/reels/:reelId/comments
router.get(
  "/:reelId/comments",
  requireAuth,
  [param("reelId").isMongoId().withMessage("Invalid reel id"), validateRequest],
  getComments,
);

// POST /api/reels/:reelId/comments
router.post(
  "/:reelId/comments",
  requireAuth,
  [
    param("reelId").isMongoId().withMessage("Invalid reel id"),
    body("text")
      .trim()
      .isLength({ min: 1, max: 500 })
      .withMessage("Comment text is required (max 500 chars)"),
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

// POST /api/reels/:reelId/comments/:commentId/like
router.post(
  "/:reelId/comments/:commentId/like",
  requireAuth,
  [
    param("reelId").isMongoId().withMessage("Invalid reel id"),
    param("commentId").isMongoId().withMessage("Invalid comment id"),
    validateRequest,
  ],
  likeComment,
);

// POST /api/reels/:reelId/comments/:commentId/dislike
router.post(
  "/:reelId/comments/:commentId/dislike",
  requireAuth,
  [
    param("reelId").isMongoId().withMessage("Invalid reel id"),
    param("commentId").isMongoId().withMessage("Invalid comment id"),
    validateRequest,
  ],
  dislikeComment,
);

// DELETE /api/reels/:reelId/comments/:commentId
router.delete(
  "/:reelId/comments/:commentId",
  requireAuth,
  [
    param("reelId").isMongoId().withMessage("Invalid reel id"),
    param("commentId").isMongoId().withMessage("Invalid comment id"),
    validateRequest,
  ],
  deleteComment,
);

module.exports = router;
