const { Router } = require("express");
const { requireAuth } = require("../middlewares/auth");
const {
  getConversations,
  getFriendNotes,
  getMessages,
  upsertMyNote,
  clearMyNote,
  sendMessage,
} = require("../controllers/messageController");

const router = Router();

// List all conversations
router.get("/conversations", requireAuth, getConversations);

// Notes (friend-visible)
router.get("/notes", requireAuth, getFriendNotes);
router.put("/notes/me", requireAuth, upsertMyNote);
router.delete("/notes/me", requireAuth, clearMyNote);

// Get messages with a specific user
router.get("/:userId", requireAuth, getMessages);

// Send a message to a specific user
router.post("/:userId", requireAuth, sendMessage);

module.exports = router;
