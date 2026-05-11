const express = require("express");
const { param } = require("express-validator");
const {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  getFriendshipStatusController,
  listFriends,
  listIncomingFriendRequests,
  listOutgoingFriendRequests,
  listUserFriends,
  sendFriendRequest,
  unfriendUser,
} = require("../controllers/friendController");
const { requireAuth } = require("../middlewares/auth");
const { validateRequest } = require("../utils/validateRequest");

const router = express.Router();

router.get("/", requireAuth, listFriends);
router.get("/requests/incoming", requireAuth, listIncomingFriendRequests);
router.get("/requests/outgoing", requireAuth, listOutgoingFriendRequests);
router.get(
  "/status/:userId",
  requireAuth,
  [param("userId").isMongoId().withMessage("Invalid user id"), validateRequest],
  getFriendshipStatusController,
);
router.get(
  "/:userId/list",
  requireAuth,
  [param("userId").isMongoId().withMessage("Invalid user id"), validateRequest],
  listUserFriends,
);
router.post(
  "/request/:userId",
  requireAuth,
  [param("userId").isMongoId().withMessage("Invalid user id"), validateRequest],
  sendFriendRequest,
);
router.post(
  "/request/:userId/cancel",
  requireAuth,
  [param("userId").isMongoId().withMessage("Invalid user id"), validateRequest],
  cancelFriendRequest,
);
router.post(
  "/request/:userId/accept",
  requireAuth,
  [param("userId").isMongoId().withMessage("Invalid user id"), validateRequest],
  acceptFriendRequest,
);
router.post(
  "/request/:userId/decline",
  requireAuth,
  [param("userId").isMongoId().withMessage("Invalid user id"), validateRequest],
  declineFriendRequest,
);
router.delete(
  "/:userId",
  requireAuth,
  [param("userId").isMongoId().withMessage("Invalid user id"), validateRequest],
  unfriendUser,
);

module.exports = router;
