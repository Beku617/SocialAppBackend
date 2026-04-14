const { Router } = require("express");
const { requireAuth } = require("../middlewares/auth");
const {
  acceptRequest,
  blockRequestSender,
  deleteRequest,
  getConversations,
  getFriendNotes,
  getMessages,
  getRequests,
  upsertMyNote,
  clearMyNote,
  sendMessage,
} = require("../controllers/messageController");

const router = Router();

// List all conversations
router.get("/conversations", requireAuth, getConversations);
router.get("/requests", requireAuth, getRequests);
router.post("/requests/:userId/accept", requireAuth, acceptRequest);
router.delete("/requests/:userId", requireAuth, deleteRequest);
router.post("/requests/:userId/block", requireAuth, blockRequestSender);

// Notes (friend-visible)
router.get("/notes", requireAuth, getFriendNotes);
router.put("/notes/me", requireAuth, upsertMyNote);
router.delete("/notes/me", requireAuth, clearMyNote);

// Get messages with a specific user
router.get("/:userId", requireAuth, getMessages);

// Send a message to a specific user
router.post("/:userId", requireAuth, sendMessage);

module.exports = router;
