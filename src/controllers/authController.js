const bcrypt = require("bcryptjs");
const Notification = require("../models/Notification");
const Reel = require("../models/Reel");
const User = require("../models/User");
const { createHttpError } = require("../utils/httpError");
const { generateToken } = require("../utils/generateToken");
const { serializePost } = require("../utils/serializePost");
const { createUserNotification } = require("../utils/notificationCenter");
const { buildBanSnapshot, ensureUserCanAccess } = require("../utils/userAccess");
const { isExpoPushToken } = require("../utils/pushNotifications");

const buildUsernameBase = (value) => {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, "")
    .slice(0, 24);

  return normalized || `user${Date.now().toString().slice(-6)}`;
};

const createUniqueUsername = async (name, email) => {
  const base = buildUsernameBase(email.split("@")[0] || name);
  let candidate = base;
  let suffix = 1;

  while (await User.exists({ username: candidate })) {
    candidate = `${base}${suffix}`.slice(0, 30);
    suffix += 1;
  }

  return candidate;
};

const buildAuthUserPayload = (user) => ({
  ...user.toJSON(),
  ban: buildBanSnapshot(user),
});

const toIdString = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value._id) return value._id.toString();
  return value.toString();
};

const hasUserId = (values, userId) =>
  Array.isArray(values) &&
  values.some((value) => toIdString(value) === String(userId));

const addUniqueUserId = (values, userId) => {
  const normalizedUserId = String(userId);
  if (!hasUserId(values, normalizedUserId)) {
    values.push(normalizedUserId);
  }
};

const removeUserId = (values, userId) =>
  Array.isArray(values)
    ? values.filter((value) => toIdString(value) !== String(userId))
    : [];

const buildBlockedIdSet = (user) =>
  new Set(
    Array.isArray(user?.blockedUsers) ? user.blockedUsers.map(toIdString) : [],
  );

const isBlockedRelation = (leftUser, rightUserId) =>
  hasUserId(leftUser?.blockedUsers, rightUserId);

const normalizeVisibility = (value) => {
  if (value === "followers") return "friends";
  if (value === "friends" || value === "private") return value;
  return "public";
};

const canViewerSeeContent = (visibility, authorId, viewerId, viewerFriendSet) => {
  if (authorId === viewerId) return true;
  if (visibility === "public") return true;
  if (visibility === "friends") return viewerFriendSet.has(authorId);
  return false;
};

const register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    const normalizedEmail = email.toLowerCase();

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      throw createHttpError(409, "Email already in use");
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const username = await createUniqueUsername(name, normalizedEmail);
    const user = await User.create({
      name,
      email: normalizedEmail,
      username,
      passwordHash,
      role: "user",
    });
    const token = generateToken(user._id.toString());

    return res.status(201).json({
      token,
      user: buildAuthUserPayload(user),
    });
  } catch (error) {
    return next(error);
  }
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const identifier = String(email || "").trim().toLowerCase();

    const user = await User.findOne({
      $or: [{ email: identifier }, { username: identifier }],
    });
    if (!user) {
      throw createHttpError(401, "Invalid email or password");
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      throw createHttpError(401, "Invalid email or password");
    }

    await ensureUserCanAccess(user);
    const token = generateToken(user._id.toString());
    return res.status(200).json({
      token,
      user: buildAuthUserPayload(user),
    });
  } catch (error) {
    return next(error);
  }
};

const getMe = async (req, res) => {
  const user = req.user;
  const json = buildAuthUserPayload(user);
  json.followersCount = user.followers ? user.followers.length : 0;
  json.followingCount = user.following ? user.following.length : 0;
  json.friendsCount = user.friends ? user.friends.length : 0;
  return res.status(200).json({ user: json });
};

const savePushToken = async (req, res, next) => {
  try {
    const token = String(req.body?.token || req.body?.pushToken || "").trim();
    const userId = req.user?._id?.toString?.() || "(missing-user-id)";
    console.log("[push] savePushToken received raw token:", token);
    console.log("[push] savePushToken received userId:", userId);

    if (!isExpoPushToken(token)) {
      console.warn(
        "[push] savePushToken rejected token format; expected prefix ExponentPushToken[",
      );
      throw createHttpError(400, "Invalid push token");
    }

    await User.updateOne(
      { _id: req.user._id },
      { $addToSet: { expoPushTokens: token } },
    );

    const refreshedUser = await User.findById(req.user._id)
      .select("expoPushTokens")
      .lean();
    console.log(
      "[push] saved token",
      token,
      "for",
      userId,
      "current expoPushTokens:",
      refreshedUser?.expoPushTokens || [],
    );
    return res.status(200).json({ ok: true });
  } catch (error) {
    return next(error);
  }
};

const getMyPushTokensDebug = async (req, res, next) => {
  try {
    const userId = req.user?._id?.toString?.() || "(missing-user-id)";
    const expoPushTokens = Array.isArray(req.user?.expoPushTokens)
      ? req.user.expoPushTokens
      : [];
    console.log("[push] debug my-tokens requested by userId:", userId);
    console.log("[push] debug my-tokens value:", expoPushTokens);
    return res.status(200).json({
      userId,
      expoPushTokens,
    });
  } catch (error) {
    return next(error);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const { name, bio, avatarUrl } = req.body;
    const user = req.user;

    if (name !== undefined) user.name = name;
    if (bio !== undefined) user.bio = bio;
    if (avatarUrl !== undefined) user.avatarUrl = avatarUrl;

    await user.save();
    return res.status(200).json({ user: user.toJSON() });
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
    throw createHttpError(403, "Deleting your account is not allowed");
  } catch (error) {
    return next(error);
  }
};

const searchUsers = async (req, res, next) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 1) {
      return res.status(200).json({ users: [] });
    }

    const currentUserId = req.user._id.toString();
    const blockedByCurrent = Array.isArray(req.user.blockedUsers)
      ? req.user.blockedUsers.map((id) => id.toString())
      : [];
    const excludedIds = [currentUserId, ...blockedByCurrent];
    const regex = new RegExp(q.trim(), "i");
    const users = await User.find({
      _id: { $nin: excludedIds },
      blockedUsers: { $ne: req.user._id },
      $or: [{ name: regex }, { email: regex }, { username: regex }],
    })
      .select("name username avatarUrl bio")
      .limit(20)
      .lean();

    const result = users.map((u) => ({
      id: u._id.toString(),
      name: u.name,
      username: u.username || "",
      avatarUrl: u.avatarUrl || "",
      bio: u.bio || "",
    }));

    return res.status(200).json({ users: result });
  } catch (error) {
    return next(error);
  }
};

const getUserProfile = async (req, res, next) => {
  try {
    const viewerId = req.user._id.toString();
    const user = await User.findById(req.params.userId);
    if (!user) {
      throw createHttpError(404, "User not found");
    }

    if (
      isBlockedRelation(req.user, user._id.toString()) ||
      isBlockedRelation(user, viewerId)
    ) {
      throw createHttpError(404, "User not found");
    }

    const Post = require("../models/Post");
    const viewerFriendSet = new Set(
      Array.isArray(req.user.friends) ? req.user.friends.map(toIdString) : [],
    );
    const isOwnProfile = viewerId === user._id.toString();

    const [allPosts, allReels] = await Promise.all([
      Post.find({ author: user._id })
        .sort({ createdAt: -1 })
        .populate("author", "name avatarUrl")
        .populate({
          path: "sharedPost",
          populate: {
            path: "author",
            select: "name avatarUrl",
          },
        })
        .populate("comments.author", "name avatarUrl")
        .lean(),
      Reel.find({
        author: user._id,
        ...(isOwnProfile ? {} : { status: "ready" }),
      })
        .sort({ createdAt: -1 })
        .populate("author", "name avatarUrl")
        .lean(),
    ]);

    const posts = allPosts
      .filter((post) =>
        canViewerSeeContent(
          normalizeVisibility(post.visibility),
          user._id.toString(),
          viewerId,
          viewerFriendSet,
        ),
      )
      .map((post) => {
        if (
          post.sharedPost &&
          !canViewerSeeContent(
            normalizeVisibility(post.sharedPost.visibility),
            toIdString(post.sharedPost.author),
            viewerId,
            viewerFriendSet,
          )
        ) {
          post.sharedPost = null;
        }
        return serializePost(post);
      });

    const reels = allReels
      .filter((reel) =>
        canViewerSeeContent(
          normalizeVisibility(reel.visibility),
          toIdString(reel.author),
          viewerId,
          viewerFriendSet,
        ),
      )
      .map((reel) => {
        const normalizedVisibility = normalizeVisibility(reel.visibility);
        return {
          id: reel._id.toString(),
          author: {
            id: toIdString(reel.author),
            name: reel.author?.name || "Unknown",
            avatarUrl: reel.author?.avatarUrl || "",
          },
          caption: reel.caption || "",
          music: reel.music || "",
          storageKey: reel.storageKey || "",
          originalUrl: reel.originalUrl || "",
          playbackUrl: reel.playbackUrl || "",
          thumbUrl: reel.thumbUrl || "",
          duration: reel.duration || 0,
          width: reel.width || 0,
          height: reel.height || 0,
          visibility: normalizedVisibility,
          status: reel.status || "ready",
          failureReason: reel.failureReason || "",
          likesCount: Number.isFinite(reel.likesCount)
            ? reel.likesCount
            : Array.isArray(reel.likes)
              ? reel.likes.length
              : 0,
          commentsCount: Number.isFinite(reel.commentsCount)
            ? reel.commentsCount
            : 0,
          viewsCount: Number.isFinite(reel.viewsCount)
            ? reel.viewsCount
            : Array.isArray(reel.viewers)
              ? reel.viewers.length
              : 0,
          repostsCount: Number.isFinite(reel.repostsCount)
            ? reel.repostsCount
            : 0,
          sharesCount: Number.isFinite(reel.sharesCount)
            ? reel.sharesCount
            : 0,
          savesCount: Number.isFinite(reel.savesCount)
            ? reel.savesCount
            : Array.isArray(reel.saves)
              ? reel.saves.length
              : 0,
          likedByMe: hasUserId(reel.likes, viewerId),
          savedByMe: hasUserId(reel.saves, viewerId),
          ownedByMe: toIdString(reel.author) === viewerId,
          createdAt: reel.createdAt,
          updatedAt: reel.updatedAt,
          processedAt: reel.processedAt || null,
        };
      });

    const postCount = posts.length;
    const followersCount = user.followers ? user.followers.length : 0;
    const followingCount = user.following ? user.following.length : 0;
    const friendsCount = user.friends ? user.friends.length : 0;
    const isFollowing = user.followers
      ? user.followers.some((id) => id.toString() === req.user._id.toString())
      : false;
    const isFriend = hasUserId(user.friends, viewerId);
    const friendRequestPending = hasUserId(user.friendRequestsReceived, viewerId);
    const friendRequestIncoming = hasUserId(
      req.user.friendRequestsReceived,
      user._id.toString(),
    );

    const json = user.toJSON();
    json.followersCount = followersCount;
    json.followingCount = followingCount;
    json.friendsCount = friendsCount;
    json.ban = buildBanSnapshot(user);

    return res.status(200).json({
      user: json,
      posts,
      reels,
      postCount,
      isFollowing,
      isFriend,
      isOwnProfile,
      friendRequestPending,
      friendRequestIncoming,
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

    if (
      isBlockedRelation(req.user, targetUserId) ||
      isBlockedRelation(targetUser, currentUserId.toString())
    ) {
      throw createHttpError(403, "Action not allowed");
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

    return res.status(200).json({
      isFollowing: !isFollowing,
      followersCount: targetUser.followers.length,
    });
  } catch (error) {
    return next(error);
  }
};

const sendFriendRequest = async (req, res, next) => {
  try {
    const requesterId = req.user._id.toString();
    const recipientId = req.params.userId;

    if (requesterId === recipientId) {
      throw createHttpError(400, "Cannot add yourself");
    }

    const [requester, recipient] = await Promise.all([
      User.findById(requesterId),
      User.findById(recipientId),
    ]);

    if (!requester || !recipient) {
      throw createHttpError(404, "User not found");
    }

    if (
      isBlockedRelation(requester, recipientId) ||
      isBlockedRelation(recipient, requesterId)
    ) {
      throw createHttpError(403, "Action not allowed");
    }

    if (hasUserId(requester.friends, recipientId)) {
      return res.status(200).json({ status: "friends" });
    }

    if (hasUserId(recipient.friendRequestsReceived, requesterId)) {
      return res.status(200).json({ status: "pending" });
    }

    addUniqueUserId(recipient.friendRequestsReceived, requesterId);
    addUniqueUserId(requester.friendRequestsSent, recipientId);

    addUniqueUserId(recipient.followers, requesterId);
    addUniqueUserId(requester.following, recipientId);

    await Promise.all([requester.save(), recipient.save()]);

    await createUserNotification({
      userId: recipient._id,
      type: "friend_request",
      title: `${requester.name || "Someone"} sent you a friend request`,
      body: "Accept to become friends.",
      data: {
        type: "friend_request",
        fromUserId: requesterId,
        fromUserName: requester.name || "",
        status: "pending",
      },
      push: {
        enabled: true,
        tokens: recipient.expoPushTokens || [],
        channelId: "messages",
      },
    });

    return res.status(200).json({
      status: "pending",
      followersCount: recipient.followers.length,
    });
  } catch (error) {
    return next(error);
  }
};

const acceptFriendRequest = async (req, res, next) => {
  try {
    const recipientId = req.user._id.toString();
    const requesterId = req.params.userId;

    if (recipientId === requesterId) {
      throw createHttpError(400, "Invalid friend request");
    }

    const requester = await User.findById(requesterId);
    if (!requester) {
      throw createHttpError(404, "User not found");
    }

    if (
      isBlockedRelation(req.user, requesterId) ||
      isBlockedRelation(requester, recipientId)
    ) {
      throw createHttpError(403, "Action not allowed");
    }

    const hasPendingRequest = hasUserId(
      req.user.friendRequestsReceived,
      requesterId,
    );
    if (!hasPendingRequest && !hasUserId(req.user.friends, requesterId)) {
      throw createHttpError(400, "Friend request not found");
    }

    req.user.friendRequestsReceived = removeUserId(
      req.user.friendRequestsReceived,
      requesterId,
    );
    requester.friendRequestsSent = removeUserId(
      requester.friendRequestsSent,
      recipientId,
    );

    addUniqueUserId(req.user.friends, requesterId);
    addUniqueUserId(requester.friends, recipientId);

    addUniqueUserId(req.user.followers, requesterId);
    addUniqueUserId(req.user.following, requesterId);
    addUniqueUserId(requester.followers, recipientId);
    addUniqueUserId(requester.following, recipientId);

    await Promise.all([req.user.save(), requester.save()]);

    const pendingNotification = await Notification.findOne({
      user: req.user._id,
      type: "friend_request",
      "data.fromUserId": requesterId,
      "data.status": "pending",
    }).sort({ createdAt: -1 });

    if (pendingNotification) {
      pendingNotification.read = true;
      pendingNotification.data = {
        ...(pendingNotification.data || {}),
        status: "accepted",
      };
      await pendingNotification.save();
    }

    await createUserNotification({
      userId: requester._id,
      type: "friend_request_accepted",
      title: `${req.user.name || "Someone"} accepted your friend request`,
      body: "You are now friends.",
      data: {
        type: "friend_request_accepted",
        userId: recipientId,
        userName: req.user.name || "",
      },
      push: {
        enabled: true,
        tokens: requester.expoPushTokens || [],
        channelId: "messages",
      },
    });

    return res.status(200).json({
      status: "accepted",
      friendsCount: req.user.friends.length,
    });
  } catch (error) {
    return next(error);
  }
};

const getFriends = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.userId).populate(
      "friends",
      "name username avatarUrl bio",
    );
    if (!user) {
      throw createHttpError(404, "User not found");
    }

    const friends = (user.friends || []).map((friend) => ({
      id: friend._id.toString(),
      name: friend.name,
      username: friend.username || "",
      avatarUrl: friend.avatarUrl || "",
      bio: friend.bio || "",
    }));

    return res.status(200).json({ users: friends });
  } catch (error) {
    return next(error);
  }
};

const unfriendUser = async (req, res, next) => {
  try {
    const currentUserId = req.user._id.toString();
    const targetUserId = req.params.userId;

    if (currentUserId === targetUserId) {
      throw createHttpError(400, "Cannot unfriend yourself");
    }

    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      throw createHttpError(404, "User not found");
    }

    req.user.friends = removeUserId(req.user.friends, targetUserId);
    targetUser.friends = removeUserId(targetUser.friends, currentUserId);

    req.user.friendRequestsSent = removeUserId(
      req.user.friendRequestsSent,
      targetUserId,
    );
    req.user.friendRequestsReceived = removeUserId(
      req.user.friendRequestsReceived,
      targetUserId,
    );
    targetUser.friendRequestsSent = removeUserId(
      targetUser.friendRequestsSent,
      currentUserId,
    );
    targetUser.friendRequestsReceived = removeUserId(
      targetUser.friendRequestsReceived,
      currentUserId,
    );

    await Promise.all([req.user.save(), targetUser.save()]);

    return res.status(200).json({
      status: "unfriended",
      friendsCount: req.user.friends.length,
    });
  } catch (error) {
    return next(error);
  }
};

const blockUser = async (req, res, next) => {
  try {
    const currentUserId = req.user._id.toString();
    const targetUserId = req.params.userId;

    if (currentUserId === targetUserId) {
      throw createHttpError(400, "Cannot block yourself");
    }

    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      throw createHttpError(404, "User not found");
    }

    addUniqueUserId(req.user.blockedUsers, targetUserId);

    req.user.friends = removeUserId(req.user.friends, targetUserId);
    targetUser.friends = removeUserId(targetUser.friends, currentUserId);

    req.user.following = removeUserId(req.user.following, targetUserId);
    req.user.followers = removeUserId(req.user.followers, targetUserId);
    targetUser.following = removeUserId(targetUser.following, currentUserId);
    targetUser.followers = removeUserId(targetUser.followers, currentUserId);

    req.user.friendRequestsSent = removeUserId(
      req.user.friendRequestsSent,
      targetUserId,
    );
    req.user.friendRequestsReceived = removeUserId(
      req.user.friendRequestsReceived,
      targetUserId,
    );
    targetUser.friendRequestsSent = removeUserId(
      targetUser.friendRequestsSent,
      currentUserId,
    );
    targetUser.friendRequestsReceived = removeUserId(
      targetUser.friendRequestsReceived,
      currentUserId,
    );

    await Promise.all([req.user.save(), targetUser.save()]);

    return res.status(200).json({
      status: "blocked",
      blockedUserId: targetUserId,
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

    const followers = (user.followers || []).map((u) => ({
      id: u._id.toString(),
      name: u.name,
      avatarUrl: u.avatarUrl || "",
      bio: u.bio || "",
    }));

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

    const following = (user.following || []).map((u) => ({
      id: u._id.toString(),
      name: u.name,
      avatarUrl: u.avatarUrl || "",
      bio: u.bio || "",
    }));

    return res.status(200).json({ users: following });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  register,
  login,
  getMe,
  savePushToken,
  getMyPushTokensDebug,
  updateProfile,
  changePassword,
  deleteAccount,
  searchUsers,
  getUserProfile,
  sendFriendRequest,
  acceptFriendRequest,
  unfriendUser,
  blockUser,
  getFriends,
  toggleFollow,
  getFollowers,
  getFollowing,
};
