const express = require("express");
const { body, param } = require("express-validator");
const {
  getMe,
  login,
  logout,
  refreshSession,
  register,
  updateProfile,
  changePassword,
  deleteAccount,
  getRecentSearches,
  saveRecentSearch,
  deleteRecentSearch,
  clearRecentSearches,
  searchUsers,
  getUserProfile,
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
    body("username")
      .trim()
      .isLength({ min: 3, max: 32 })
      .withMessage("Username must be 3-32 chars")
      .matches(/^[a-zA-Z0-9_.]+$/)
      .withMessage("Username can only include letters, numbers, underscore, and dot"),
    body("email").trim().isEmail().withMessage("Provide a valid email"),
    body("password")
      .isString()
      .isLength({ min: 8, max: 64 })
      .withMessage("Password must be 8-64 chars"),
    validateRequest,
  ],
  register,
);

router.post(
  "/login",
  [
    body("identifier")
      .optional()
      .trim()
      .notEmpty()
      .withMessage("Username or email is required"),
    body("email")
      .optional()
      .trim()
      .isEmail()
      .withMessage("Provide a valid email"),
    body("password").isString().notEmpty().withMessage("Password is required"),
    body().custom((value) => {
      const hasIdentifier =
        typeof value.identifier === "string" && value.identifier.trim().length > 0;
      const hasEmail = typeof value.email === "string" && value.email.trim().length > 0;
      if (!hasIdentifier && !hasEmail) {
        throw new Error("Username or email is required");
      }
      return true;
    }),
    validateRequest,
  ],
  login,
);

router.post(
  "/refresh",
  [
    body("refreshToken")
      .trim()
      .notEmpty()
      .withMessage("Refresh token is required"),
    validateRequest,
  ],
  refreshSession,
);

router.post(
  "/logout",
  [
    body("refreshToken")
      .optional()
      .isString()
      .withMessage("Refresh token must be a string"),
    validateRequest,
  ],
  logout,
);

router.get("/me", requireAuth, getMe);

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

router.get("/search/recent", requireAuth, getRecentSearches);

router.post(
  "/search/recent",
  requireAuth,
  [
    body("kind")
      .isIn(["query", "user"])
      .withMessage("kind must be query or user"),
    body("query")
      .if(body("kind").equals("query"))
      .trim()
      .isLength({ min: 1, max: 120 })
      .withMessage("Query must be 1-120 chars"),
    body("userId")
      .if(body("kind").equals("user"))
      .isMongoId()
      .withMessage("Invalid user id"),
    validateRequest,
  ],
  saveRecentSearch,
);

router.delete("/search/recent", requireAuth, clearRecentSearches);

router.delete(
  "/search/recent/:searchId",
  requireAuth,
  [param("searchId").isMongoId().withMessage("Invalid recent search id"), validateRequest],
  deleteRecentSearch,
);

// Public profile
router.get(
  "/users/:userId",
  requireAuth,
  [param("userId").isMongoId().withMessage("Invalid user id"), validateRequest],
  getUserProfile,
);

// Follow / unfollow
router.post(
  "/users/:userId/follow",
  requireAuth,
  [param("userId").isMongoId().withMessage("Invalid user id"), validateRequest],
  toggleFollow,
);

// Followers & following lists
router.get(
  "/users/:userId/followers",
  requireAuth,
  [param("userId").isMongoId().withMessage("Invalid user id"), validateRequest],
  getFollowers,
);
router.get(
  "/users/:userId/following",
  requireAuth,
  [param("userId").isMongoId().withMessage("Invalid user id"), validateRequest],
  getFollowing,
);

module.exports = router;
