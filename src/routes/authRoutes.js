const express = require("express");
const { body, param, query } = require("express-validator");
const {
  checkUsernameAvailability,
  getMe,
  login,
  register,
  savePushToken,
  removePushToken,
  updateProfile,
  changePassword,
  deleteAccount,
  searchUsers,
  getUserProfile,
  sendFriendRequest,
  acceptFriendRequest,
  unfriendUser,
  blockUser,
  unblockUser,
  getBlockedUsers,
  getFriends,
  toggleFollow,
  getFollowers,
  getFollowing,
} = require("../controllers/authController");
const { requireAuth } = require("../middlewares/auth");
const { validateRequest } = require("../utils/validateRequest");

const router = express.Router();

router.post(
  "/register",
  [
    body("email").trim().isEmail().withMessage("Provide a valid email"),
    body("username")
      .trim()
      .matches(/^[a-zA-Z0-9._]{3,30}$/)
      .withMessage(
        "Username must be 3-30 chars and use letters, numbers, dot, or underscore",
      ),
    body("password")
      .isString()
      .isLength({ min: 8, max: 64 })
      .withMessage("Password must be 8-64 chars"),
    validateRequest,
  ],
  register,
);

router.get(
  "/username/check",
  [
    query("username")
      .optional({ values: "falsy" })
      .isString()
      .withMessage("username must be a string"),
    validateRequest,
  ],
  checkUsernameAvailability,
);

router.post(
  "/login",
  [
    body("email")
      .trim()
      .isLength({ min: 1 })
      .withMessage("Provide an email or username"),
    body("password").isString().notEmpty().withMessage("Password is required"),
    validateRequest,
  ],
  login,
);

router.get("/me", requireAuth, getMe);

router.post(
  "/push-token",
  requireAuth,
  [
    body().custom((_, { req }) => {
      const token = String(req.body?.token || req.body?.pushToken || "").trim();
      if (!token) {
        throw new Error("Push token is required");
      }
      return true;
    }),
    validateRequest,
  ],
  savePushToken,
);

router.delete(
  "/push-token",
  requireAuth,
  [
    body().custom((_, { req }) => {
      const token = String(req.body?.token || req.body?.pushToken || "").trim();
      if (!token) {
        throw new Error("Push token is required");
      }
      return true;
    }),
    validateRequest,
  ],
  removePushToken,
);

router.put(
  "/me",
  requireAuth,
  [
    body("name")
      .optional()
      .trim()
      .isLength({ min: 2, max: 60 })
      .withMessage("Name must be 2-60 chars"),
    body("bio")
      .optional()
      .trim()
      .isLength({ max: 160 })
      .withMessage("Bio max 160 chars"),
    body("avatarUrl")
      .optional({ values: "falsy" })
      .isString()
      .withMessage("avatarUrl must be a string"),
    validateRequest,
  ],
  updateProfile,
);

router.put(
  "/me/password",
  requireAuth,
  [
    body("currentPassword")
      .isString()
      .notEmpty()
      .withMessage("Current password is required"),
    body("newPassword")
      .isString()
      .isLength({ min: 8, max: 64 })
      .withMessage("New password must be 8-64 chars"),
    validateRequest,
  ],
  changePassword,
);

router.delete("/me", requireAuth, deleteAccount);

// Search users
router.get("/users/search", requireAuth, searchUsers);

// Public profile
router.get("/users/:userId", requireAuth, getUserProfile);

// Follow / unfollow
router.post("/users/:userId/follow", requireAuth, toggleFollow);
router.post(
  "/users/:userId/friend-request",
  requireAuth,
  [param("userId").isMongoId().withMessage("Invalid user id"), validateRequest],
  sendFriendRequest,
);
router.post(
  "/users/:userId/friend-accept",
  requireAuth,
  [param("userId").isMongoId().withMessage("Invalid user id"), validateRequest],
  acceptFriendRequest,
);
router.post(
  "/users/:userId/unfriend",
  requireAuth,
  [param("userId").isMongoId().withMessage("Invalid user id"), validateRequest],
  unfriendUser,
);
router.post(
  "/users/:userId/block",
  requireAuth,
  [param("userId").isMongoId().withMessage("Invalid user id"), validateRequest],
  blockUser,
);
router.post(
  "/users/:userId/unblock",
  requireAuth,
  [param("userId").isMongoId().withMessage("Invalid user id"), validateRequest],
  unblockUser,
);
router.get("/users/me/blocked", requireAuth, getBlockedUsers);

// Followers & following lists
router.get("/users/:userId/followers", requireAuth, getFollowers);
router.get("/users/:userId/following", requireAuth, getFollowing);
router.get("/users/:userId/friends", requireAuth, getFriends);

module.exports = router;
