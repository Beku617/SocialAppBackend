const { Router } = require("express");
const { requireAuth } = require("../middlewares/auth");
const {
  getConversations,
  getMessages,
  sendMessage,
} = require("../controllers/messageController");

const router = Router();

// List all conversations
router.get("/conversations", requireAuth, getConversations);

// Get messages with a specific user
router.get("/:userId", requireAuth, getMessages);

// Send a message to a specific user
router.post("/:userId", requireAuth, sendMessage);

module.exports = router;
