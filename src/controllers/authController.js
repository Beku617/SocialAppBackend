const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { createHttpError } = require("../utils/httpError");
const { env } = require("../config/env");
const { generateAuthTokens } = require("../utils/generateToken");
const FriendRequest = require("../models/FriendRequest");
const {
  deleteNotifications,
  replaceNotification,
} = require("../utils/notifications");
const {
  buildFriendshipStatusMap,
  getFriendshipStatus,
  mapUserPreview,
  normalizeId,
} = require("../utils/friendships");
const { isAdminUser } = require("../utils/admin");
const {
  buildActiveAccountQuery,
  getUserStatusErrorMessage,
  isUserActive,
} = require("../utils/userAccountStatus");

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MAX_RECENT_SEARCHES = 12;

const mapUserPayload = (user) => {
  const json = user.toJSON();
  const isAdmin = isAdminUser(user);
  json.role = user.role || (isAdmin ? "admin" : "user");
  json.isAdmin = isAdmin;
  json.accountStatus = user.accountStatus || "active";
  json.lastLoginAt = user.lastLoginAt || null;
  return json;
};

const mapRecentSearch = (item) => {
  const targetUser = item.targetUser;
  const targetUserId =
    targetUser && typeof targetUser === "object" && targetUser._id
      ? targetUser._id.toString()
      : item.targetUser
        ? item.targetUser.toString()
        : "";

  return {
    id: item._id.toString(),
    kind: item.kind,
    query: item.query || "",
    createdAt: item.createdAt,
    user:
      item.kind === "user" && (targetUserId || item.targetUserName)
        ? {
            id: targetUserId,
            name: targetUser?.name || item.targetUserName || "Unknown user",
            avatarUrl: targetUser?.avatarUrl || item.targetUserAvatarUrl || "",
            bio: targetUser?.bio || "",
          }
        : null,
  };
};

const hashRefreshToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const buildAuthPayload = (user) => {
  const userId = user._id.toString();
  const tokens = generateAuthTokens(userId);

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString(),
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString(),
    user: mapUserPayload(user),
    refreshTokenHash: hashRefreshToken(tokens.refreshToken),
    refreshTokenExpiry: tokens.refreshTokenExpiresAt,
  };
};

const register = async (req, res, next) => {
  try {
    const username =
      typeof req.body.username === "string"
        ? req.body.username.trim().toLowerCase()
        : "";
    const email =
      typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body.password === "string" ? req.body.password : "";

    if (!username || !email || !password) {
      throw createHttpError(400, "All required fields must be provided");
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      throw createHttpError(409, "Email already in use");
    }

    const existingUsername = await User.findOne({ username });
    if (existingUsername) {
      throw createHttpError(409, "Username already taken");
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const displayName =
      typeof req.body.name === "string" && req.body.name.trim()
        ? req.body.name.trim()
        : username;
    const user = await User.create({
      name: displayName,
      username,
      email,
      passwordHash,
      role: "user",
    });

    const authPayload = buildAuthPayload(user);
    user.refreshTokenHash = authPayload.refreshTokenHash;
    user.refreshTokenExpiresAt = authPayload.refreshTokenExpiry;
    await user.save();

    return res.status(201).json({
      accessToken: authPayload.accessToken,
      refreshToken: authPayload.refreshToken,
      accessTokenExpiresAt: authPayload.accessTokenExpiresAt,
      refreshTokenExpiresAt: authPayload.refreshTokenExpiresAt,
      user: authPayload.user,
    });
  } catch (error) {
    return next(error);
  }
};

const login = async (req, res, next) => {
  try {
    const password = typeof req.body.password === "string" ? req.body.password : "";
    const rawIdentifier =
      typeof req.body.identifier === "string" && req.body.identifier.trim()
        ? req.body.identifier.trim()
        : typeof req.body.email === "string"
          ? req.body.email.trim()
          : "";

    if (!rawIdentifier || !password) {
      throw createHttpError(400, "Username or email and password are required");
    }

    const normalizedIdentifier = rawIdentifier.toLowerCase();
    const isEmail = normalizedIdentifier.includes("@");

    const user = await User.findOne(
      isEmail ? { email: normalizedIdentifier } : { username: normalizedIdentifier },
    ).select("+refreshTokenHash +refreshTokenExpiresAt");
    if (!user) {
      throw createHttpError(401, "Invalid username or password");
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      throw createHttpError(401, "Invalid username or password");
    }

    if (!isUserActive(user)) {
      throw createHttpError(403, getUserStatusErrorMessage(user.accountStatus));
    }

    user.lastLoginAt = new Date();
    const authPayload = buildAuthPayload(user);
    user.refreshTokenHash = authPayload.refreshTokenHash;
    user.refreshTokenExpiresAt = authPayload.refreshTokenExpiry;
    await user.save();

    return res.status(200).json({
      accessToken: authPayload.accessToken,
      refreshToken: authPayload.refreshToken,
      accessTokenExpiresAt: authPayload.accessTokenExpiresAt,
      refreshTokenExpiresAt: authPayload.refreshTokenExpiresAt,
      user: authPayload.user,
    });
  } catch (error) {
    return next(error);
  }
};

const refreshSession = async (req, res, next) => {
  try {
    const refreshToken =
      typeof req.body.refreshToken === "string" ? req.body.refreshToken.trim() : "";

    if (!refreshToken) {
      throw createHttpError(401, "Invalid refresh token");
    }

    let payload;
    try {
      payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET);
    } catch (_error) {
      throw createHttpError(401, "Invalid refresh token");
    }

    if (!payload || payload.type !== "refresh" || !payload.sub) {
      throw createHttpError(401, "Invalid refresh token");
    }

    const user = await User.findById(payload.sub).select(
      "+refreshTokenHash +refreshTokenExpiresAt",
    );
    if (!user) {
      throw createHttpError(401, "Invalid refresh token");
    }

    if (!isUserActive(user)) {
      throw createHttpError(403, getUserStatusErrorMessage(user.accountStatus));
    }

    if (
      !user.refreshTokenHash ||
      !user.refreshTokenExpiresAt ||
      user.refreshTokenExpiresAt.getTime() <= Date.now()
    ) {
      throw createHttpError(401, "Session expired");
    }

    const incomingHash = hashRefreshToken(refreshToken);
    if (incomingHash !== user.refreshTokenHash) {
      throw createHttpError(401, "Invalid refresh token");
    }

    const authPayload = buildAuthPayload(user);
    user.refreshTokenHash = authPayload.refreshTokenHash;
    user.refreshTokenExpiresAt = authPayload.refreshTokenExpiry;
    await user.save();

    return res.status(200).json({
      accessToken: authPayload.accessToken,
      refreshToken: authPayload.refreshToken,
      accessTokenExpiresAt: authPayload.accessTokenExpiresAt,
      refreshTokenExpiresAt: authPayload.refreshTokenExpiresAt,
      user: authPayload.user,
    });
  } catch (error) {
    return next(error);
  }
};

const logout = async (req, res, next) => {
  try {
    const refreshToken =
      typeof req.body.refreshToken === "string" ? req.body.refreshToken.trim() : "";

    if (refreshToken) {
      try {
        const payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET);
        if (payload?.sub) {
          await User.findByIdAndUpdate(payload.sub, {
            $set: {
              refreshTokenHash: null,
              refreshTokenExpiresAt: null,
            },
          });
        }
      } catch (_error) {
        // Intentionally ignore invalid tokens to make logout idempotent.
      }
    }

    return res.status(200).json({ message: "Logged out" });
  } catch (error) {
    return next(error);
  }
};

const getMe = async (req, res) => {
  const user = req.user;
  const json = mapUserPayload(user);
  json.friendsCount = user.friends ? user.friends.length : 0;
  json.followersCount = user.followers ? user.followers.length : 0;
  json.followingCount = user.following ? user.following.length : 0;
  return res.status(200).json({ user: json });
};

const updateProfile = async (req, res, next) => {
  try {
    const { name, bio, avatarUrl } = req.body;
    const user = req.user;

    if (name !== undefined) user.name = name;
    if (bio !== undefined) user.bio = bio;
    if (avatarUrl !== undefined) user.avatarUrl = avatarUrl;

    await user.save();
    return res.status(200).json({ user: mapUserPayload(user) });
  } catch (error) {
    return next(error);
  }
};

const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = req.user;

    const match = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!match) {
      throw createHttpError(400, "Current password is incorrect");
    }

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    await user.save();
    return res.status(200).json({ message: "Password updated" });
  } catch (error) {
    return next(error);
  }
};

const deleteAccount = async (req, res, next) => {
  try {
    const Post = require("../models/Post");
    const PushToken = require("../models/PushToken");
    // Remove user's posts
    await Post.deleteMany({ author: req.user._id });
    await FriendRequest.deleteMany({
      $or: [{ requester: req.user._id }, { recipient: req.user._id }],
    });
    await User.updateMany(
      {
        $or: [
          { followers: req.user._id },
          { following: req.user._id },
          { friends: req.user._id },
        ],
      },
      {
        $pull: {
          followers: req.user._id,
          following: req.user._id,
          friends: req.user._id,
        },
      },
    );
    await deleteNotifications({
      $or: [{ recipient: req.user._id }, { actor: req.user._id }],
    });
    await PushToken.deleteMany({ user: req.user._id });
    // Remove the user
    await User.deleteOne({ _id: req.user._id });
    return res.status(200).json({ message: "Account deleted" });
  } catch (error) {
    return next(error);
  }
};

const searchUsers = async (req, res, next) => {
  try {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const mode = req.query.mode === "mention" ? "mention" : "default";

    if (!query && mode !== "mention") {
      return res.status(200).json({ users: [] });
    }

    const filters = [];

    if (mode === "mention") {
      if (query) {
        filters.push({ name: new RegExp(`^${escapeRegex(query)}`, "i") });
      }
      filters.push({ _id: { $ne: req.user._id } });
    } else {
      const regex = new RegExp(escapeRegex(query), "i");
      filters.push({
        $or: [{ name: regex }, { email: regex }],
      });
      filters.push({ _id: { $ne: req.user._id } });
    }

    filters.push(buildActiveAccountQuery());
    filters.push({ role: "user" });

    const users = await User.find(filters.length > 1 ? { $and: filters } : filters[0] || {})
      .select("name avatarUrl bio")
      .sort({ name: 1 })
      .limit(20)
      .lean();

    const friendshipStatusMap = await buildFriendshipStatusMap(
      req.user,
      users.map((user) => user._id),
    );

    const result = users.map((u) =>
      mapUserPreview(u, friendshipStatusMap[normalizeId(u._id)]),
    );

    return res.status(200).json({ users: result });
  } catch (error) {
    return next(error);
  }
};

const getRecentSearches = async (req, res, next) => {
  try {
    await req.user.populate("recentSearches.targetUser", "name avatarUrl bio");

    const items = [...(req.user.recentSearches || [])]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map(mapRecentSearch);

    return res.status(200).json({ items });
  } catch (error) {
    return next(error);
  }
};

const saveRecentSearch = async (req, res, next) => {
  try {
    const kind = req.body.kind === "user" ? "user" : "query";
    const currentUser = req.user;
    const currentSearches = Array.isArray(currentUser.recentSearches)
      ? [...currentUser.recentSearches]
      : [];

    if (kind === "query") {
      const query = typeof req.body.query === "string" ? req.body.query.trim() : "";
      if (!query) {
        throw createHttpError(400, "Query is required");
      }

      currentUser.recentSearches = [
        {
          kind: "query",
          query,
          createdAt: new Date(),
        },
        ...currentSearches.filter(
          (item) =>
            !(
              item.kind === "query" &&
              item.query &&
              item.query.toLowerCase() === query.toLowerCase()
            ),
        ),
      ].slice(0, MAX_RECENT_SEARCHES);
    } else {
      const targetUserId =
        typeof req.body.userId === "string" ? req.body.userId.trim() : "";
      if (!targetUserId) {
        throw createHttpError(400, "User is required");
      }

      const targetUser = await User.findById(targetUserId).select("name avatarUrl");
      if (!targetUser) {
        throw createHttpError(404, "User not found");
      }

      currentUser.recentSearches = [
        {
          kind: "user",
          targetUser: targetUser._id,
          targetUserName: targetUser.name,
          targetUserAvatarUrl: targetUser.avatarUrl || "",
          createdAt: new Date(),
        },
        ...currentSearches.filter(
          (item) =>
            !(
              item.kind === "user" &&
              item.targetUser &&
              item.targetUser.toString() === targetUser._id.toString()
            ),
        ),
      ].slice(0, MAX_RECENT_SEARCHES);
    }

    await currentUser.save();
    await currentUser.populate("recentSearches.targetUser", "name avatarUrl bio");

    const savedItem = currentUser.recentSearches[0];
    return res.status(201).json({
      item: savedItem ? mapRecentSearch(savedItem) : null,
      items: currentUser.recentSearches.map(mapRecentSearch),
    });
  } catch (error) {
    return next(error);
  }
};

const deleteRecentSearch = async (req, res, next) => {
  try {
    const recentSearchId = req.params.searchId;
    req.user.recentSearches = (req.user.recentSearches || []).filter(
      (item) => item._id.toString() !== recentSearchId,
    );
    await req.user.save();

    return res.status(200).json({ message: "Recent search removed" });
  } catch (error) {
    return next(error);
  }
};

const clearRecentSearches = async (req, res, next) => {
  try {
    req.user.recentSearches = [];
    await req.user.save();

    return res.status(200).json({ message: "Recent searches cleared" });
  } catch (error) {
    return next(error);
  }
};

const getUserProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      throw createHttpError(404, "User not found");
    }
    if (!isUserActive(user)) {
      throw createHttpError(404, "User not found");
    }
    if (isAdminUser(user)) {
      throw createHttpError(404, "User not found");
    }

    const Post = require("../models/Post");
    const posts = await Post.find({ author: user._id })
      .sort({ createdAt: -1 })
      .populate("author", "name avatarUrl")
      .populate("comments.author", "name avatarUrl")
      .populate("comments.mentions.user", "name avatarUrl");

    const postCount = posts.length;
    const friendsCount = user.friends ? user.friends.length : 0;
    const followersCount = user.followers ? user.followers.length : 0;
    const followingCount = user.following ? user.following.length : 0;
    const isFollowing = user.followers
      ? user.followers.some((id) => id.toString() === req.user._id.toString())
      : false;
    const friendshipStatus = await getFriendshipStatus(req.user, user._id);

    const json = user.toJSON();
    json.friendsCount = friendsCount;
    json.followersCount = followersCount;
    json.followingCount = followingCount;

    return res.status(200).json({
      user: json,
      posts,
      postCount,
      isFollowing,
      friendshipStatus,
    });
  } catch (error) {
    return next(error);
  }
};

const toggleFollow = async (req, res, next) => {
  try {
    const currentUserId = req.user._id;
    const targetUserId = req.params.userId;

    if (currentUserId.toString() === targetUserId) {
      throw createHttpError(400, "Cannot follow yourself");
    }

    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      throw createHttpError(404, "User not found");
    }
    if (!isUserActive(targetUser)) {
      throw createHttpError(404, "User not found");
    }
    if (isAdminUser(targetUser)) {
      throw createHttpError(404, "User not found");
    }

    const currentUser = await User.findById(currentUserId);
    const isFollowing = targetUser.followers.some(
      (id) => id.toString() === currentUserId.toString(),
    );

    if (isFollowing) {
      // Unfollow
      targetUser.followers = targetUser.followers.filter(
        (id) => id.toString() !== currentUserId.toString(),
      );
      currentUser.following = currentUser.following.filter(
        (id) => id.toString() !== targetUserId,
      );
    } else {
      // Follow
      targetUser.followers.push(currentUserId);
      currentUser.following.push(targetUserId);
    }

    await Promise.all([targetUser.save(), currentUser.save()]);

    if (!isFollowing) {
      await replaceNotification({
        filter: {
          recipient: targetUser._id,
          actor: currentUser._id,
          type: "follow",
        },
        recipientId: targetUser._id,
        actor: currentUser,
        type: "follow",
        message: "started following you.",
        referenceId: currentUser._id.toString(),
      });
    } else {
      await deleteNotifications({
        recipient: targetUser._id,
        actor: currentUser._id,
        type: "follow",
      });
    }

    return res.status(200).json({
      isFollowing: !isFollowing,
      followersCount: targetUser.followers.length,
    });
  } catch (error) {
    return next(error);
  }
};

const getFollowers = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.userId).populate(
      "followers",
      "name avatarUrl bio",
    );
    if (!user) {
      throw createHttpError(404, "User not found");
    }
    if (!isUserActive(user)) {
      throw createHttpError(404, "User not found");
    }
    if (isAdminUser(user)) {
      throw createHttpError(404, "User not found");
    }

    const friendshipStatusMap = await buildFriendshipStatusMap(
      req.user,
      (user.followers || []).map((u) => u._id),
    );

    const followers = (user.followers || []).map((u) =>
      mapUserPreview(u, friendshipStatusMap[normalizeId(u._id)]),
    );

    return res.status(200).json({ users: followers });
  } catch (error) {
    return next(error);
  }
};

const getFollowing = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.userId).populate(
      "following",
      "name avatarUrl bio",
    );
    if (!user) {
      throw createHttpError(404, "User not found");
    }
    if (!isUserActive(user)) {
      throw createHttpError(404, "User not found");
    }
    if (isAdminUser(user)) {
      throw createHttpError(404, "User not found");
    }

    const friendshipStatusMap = await buildFriendshipStatusMap(
      req.user,
      (user.following || []).map((u) => u._id),
    );

    const following = (user.following || []).map((u) =>
      mapUserPreview(u, friendshipStatusMap[normalizeId(u._id)]),
    );

    return res.status(200).json({ users: following });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  register,
  login,
  refreshSession,
  logout,
  getMe,
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
};
