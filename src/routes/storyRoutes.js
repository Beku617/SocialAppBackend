const { Router } = require("express");
const { body } = require("express-validator");
const { requireAuth } = require("../middlewares/auth");
const { validateRequest } = require("../utils/validateRequest");
const {
  listStories,
  createStory,
  viewStory,
  deleteStory,
} = require("../controllers/storyController");

const router = Router();

// GET  /api/stories           — list all active stories (auth optional for grouping)
router.get("/", requireAuth, listStories);

// POST /api/stories           — create a story
router.post(
  "/",
  requireAuth,
  [
    body("imageUrl")
      .notEmpty()
      .withMessage("imageUrl is required")
      .isString()
      .withMessage("imageUrl must be a string"),
    body("caption")
      .optional()
      .isString()
      .isLength({ max: 200 })
      .withMessage("Caption max 200 chars"),
    validateRequest,
  ],
  createStory,
);

// POST /api/stories/:storyId/view — mark a story as viewed
router.post("/:storyId/view", requireAuth, viewStory);

// DELETE /api/stories/:storyId — delete own story
router.delete("/:storyId", requireAuth, deleteStory);

module.exports = router;
