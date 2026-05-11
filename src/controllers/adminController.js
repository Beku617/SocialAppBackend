const bcrypt = require("bcryptjs");
const AdminAuditLog = require("../models/AdminAuditLog");
const AdminNotificationCampaign = require("../models/AdminNotificationCampaign");
const Notification = require("../models/Notification");
const Post = require("../models/Post");
const PushToken = require("../models/PushToken");
const Reel = require("../models/Reel");
const Story = require("../models/Story");
const User = require("../models/User");
const { createHttpError } = require("../utils/httpError");
const { generateToken } = require("../utils/generateToken");
const {
  createAdminNotifications,
  mapCampaign,
} = require("../utils/adminNotifications");
const { createAdminAuditLog, mapAdminAuditLog } = require("../utils/adminAudit");
const {
  getNotificationPreferenceUpdates,
  getOrCreateNotificationPreferences,
} = require("../utils/notificationPreferences");
const { sendPushToUser } = require("../utils/pushNotifications");
const { isAdminUser } = require("../utils/admin");
const {
  USER_ACCOUNT_STATUSES,
  buildActiveAccountQuery,
  getUserStatusErrorMessage,
  isUserActive,
} = require("../utils/userAccountStatus");

const ADMIN_NOTIFICATION_CATEGORIES = [
  "announcement",
  "maintenance",
  "policy",
  "reminder",
  "feature",
  "direct",
];

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parsePage = (value, fallback = 1) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const parseLimit = (value, fallback = 20, max = 50) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(max, Math.floor(parsed));
};

const mapAdminUser = (user) => ({
  id: user._id.toString(),
  name: user.name,
  email: user.email,
  role: "admin",
  accountStatus: user.accountStatus || "active",
});

const mapNotificationPreferences = (preferences) => ({
  pushEnabled: Boolean(preferences.pushEnabled),
  messagePushEnabled: Boolean(preferences.messagePushEnabled),
  friendRequestPushEnabled: Boolean(preferences.friendRequestPushEnabled),
  friendAcceptPushEnabled: Boolean(preferences.friendAcceptPushEnabled),
  likePushEnabled: Boolean(preferences.likePushEnabled),
  commentPushEnabled: Boolean(preferences.commentPushEnabled),
  replyPushEnabled: Boolean(preferences.replyPushEnabled),
  updatedAt: preferences.updatedAt,
  updatedBy: preferences.updatedBy
    ? {
        id: preferences.updatedBy._id.toString(),
        name: preferences.updatedBy.name,
        email: preferences.updatedBy.email,
        role:
          preferences.updatedBy.role ||
          (isAdminUser(preferences.updatedBy) ? "admin" : "user"),
      }
    : null,
});

const mapAdminUserListItem = (user) => ({
  id: user._id.toString(),
  name: user.name,
  email: user.email,
  avatarUrl: user.avatarUrl || "",
  role: user.role || "user",
  accountStatus: user.accountStatus || "active",
  statusReason: user.statusReason || "",
  createdAt: user.createdAt,
  lastLoginAt: user.lastLoginAt || null,
  followersCount:
    user.followersCount ?? (Array.isArray(user.followers) ? user.followers.length : 0),
  followingCount:
    user.followingCount ?? (Array.isArray(user.following) ? user.following.length : 0),
  friendsCount:
    user.friendsCount ?? (Array.isArray(user.friends) ? user.friends.length : 0),
});

const mapAdminUserDetail = (user, extras = {}) => ({
  id: user._id.toString(),
  name: user.name,
  email: user.email,
  avatarUrl: user.avatarUrl || "",
  bio: user.bio || "",
  role: user.role || "user",
  accountStatus: user.accountStatus || "active",
  statusReason: user.statusReason || "",
  statusUpdatedAt: user.statusUpdatedAt || null,
  statusUpdatedBy: user.statusUpdatedBy
    ? {
        id: user.statusUpdatedBy._id.toString(),
        name: user.statusUpdatedBy.name,
        email: user.statusUpdatedBy.email,
      }
    : null,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
  lastLoginAt: user.lastLoginAt || null,
  followersCount: Array.isArray(user.followers) ? user.followers.length : 0,
  followingCount: Array.isArray(user.following) ? user.following.length : 0,
  friendsCount: Array.isArray(user.friends) ? user.friends.length : 0,
  ...extras,
});

const mapRecentUser = (user) => ({
  id: user._id.toString(),
  name: user.name,
  email: user.email,
  avatarUrl: user.avatarUrl || "",
  role: user.role || "user",
  accountStatus: user.accountStatus || "active",
  createdAt: user.createdAt,
  lastLoginAt: user.lastLoginAt || null,
});

const mapRecentNotification = (notification) => ({
  id: notification._id.toString(),
  type: notification.type,
  title: notification.title || "",
  message: notification.message,
  category: notification.category || "activity",
  deepLink: notification.deepLink || "",
  isRead: Boolean(notification.isRead),
  createdAt: notification.createdAt,
});

const mapNotificationSendResult = (result) => ({
  campaign: result.campaign ? mapCampaign(result.campaign) : null,
  deduplicated: Boolean(result.deduplicated),
  queued: Boolean(result.queued),
  requestedRecipientCount: Number(result.requestedRecipientCount || 0),
  recipientCount: Number(result.recipientCount || 0),
  skippedRecipientCount: Number(result.skippedRecipientCount || 0),
  invalidRecipientCount: Number(result.invalidRecipientCount || 0),
  inAppCreatedCount: Number(result.inAppCreatedCount || 0),
  failedRecipientCount: Number(result.failedRecipientCount || 0),
  pushAttemptedCount: Number(result.pushAttemptedCount || 0),
  pushDeliveredCount: Number(result.pushDeliveredCount || 0),
  pushSkippedCount: Number(result.pushSkippedCount || 0),
  pushFailedCount: Number(result.pushFailedCount || 0),
});

const buildUserFilters = (query = {}) => {
  const filters = [];
  const trimmedQuery =
    typeof query.q === "string" ? query.q.trim() : "";

  if (trimmedQuery) {
    const regex = new RegExp(escapeRegex(trimmedQuery), "i");
    filters.push({ $or: [{ name: regex }, { email: regex }] });
  }

  if (query.role === "user" || query.role === "admin") {
    filters.push({ role: query.role });
  }

  if (
    typeof query.status === "string" &&
    USER_ACCOUNT_STATUSES.includes(query.status)
  ) {
    if (query.status === "active") {
      filters.push(buildActiveAccountQuery());
    } else {
      filters.push({ accountStatus: query.status });
    }
  }

  if (query.recent === "7d" || query.recent === "30d") {
    const days = query.recent === "7d" ? 7 : 30;
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    filters.push({ createdAt: { $gte: sinceDate } });
  }

  if (!filters.length) {
    return {};
  }

  if (filters.length === 1) {
    return filters[0];
  }

  return { $and: filters };
};

const loginAdmin = async (req, res, next) => {
  try {
    const email =
      typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body.password === "string" ? req.body.password : "";

    if (!email || !password) {
      throw createHttpError(400, "Email and password are required");
    }

    const user = await User.findOne({ email });
    if (!user || !isAdminUser(user)) {
      throw createHttpError(401, "Invalid admin credentials");
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      throw createHttpError(401, "Invalid admin credentials");
    }

    if (!isUserActive(user)) {
      throw createHttpError(403, getUserStatusErrorMessage(user.accountStatus));
    }

    user.lastLoginAt = new Date();
    await user.save();

    const token = generateToken(user._id.toString());

    return res.status(200).json({
      token,
      admin: mapAdminUser(user),
    });
  } catch (error) {
    return next(error);
  }
};

const getAdminSession = async (req, res, next) => {
  try {
    if (!req.user || !req.isAdmin) {
      throw createHttpError(403, "Admin access required");
    }

    return res.status(200).json({
      admin: mapAdminUser(req.user),
    });
  } catch (error) {
    return next(error);
  }
};

const getDashboardOverview = async (_req, res, next) => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      activeUsers,
      newUsersCount,
      totalPosts,
      totalReels,
      totalStories,
      totalCampaigns,
      recipientStats,
      statusBreakdown,
      recentUsers,
      recentCampaigns,
      recentlySignedInUsers,
      recentAuditLogs,
    ] = await Promise.all([
      User.countDocuments({ role: "user" }),
      User.countDocuments({
        role: "user",
        ...buildActiveAccountQuery(),
      }),
      User.countDocuments({ role: "user", createdAt: { $gte: sevenDaysAgo } }),
      Post.countDocuments(),
      Reel.countDocuments(),
      Story.countDocuments(),
      AdminNotificationCampaign.countDocuments(),
      AdminNotificationCampaign.aggregate([
        {
          $group: {
            _id: null,
            totalRecipients: {
              $sum: {
                $ifNull: ["$inAppCreatedCount", "$recipientCount"],
              },
            },
          },
        },
      ]),
      User.aggregate([
        { $match: { role: "user" } },
        {
          $group: {
            _id: "$accountStatus",
            count: { $sum: 1 },
          },
        },
      ]),
      User.find({ role: "user" })
        .select("name email avatarUrl role accountStatus createdAt lastLoginAt")
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      AdminNotificationCampaign.find()
        .populate("sender", "name email")
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      User.find({
        role: "user",
        lastLoginAt: { $gte: thirtyDaysAgo },
      })
        .select("name email avatarUrl role accountStatus createdAt lastLoginAt")
        .sort({ lastLoginAt: -1 })
        .limit(5)
        .lean(),
      AdminAuditLog.find()
        .populate("adminUser", "name email")
        .sort({ createdAt: -1 })
        .limit(6)
        .lean(),
    ]);

    const statusMap = {
      active: 0,
      suspended: 0,
      banned: 0,
      deactivated: 0,
    };

    statusBreakdown.forEach((item) => {
      if (item?._id && Object.prototype.hasOwnProperty.call(statusMap, item._id)) {
        statusMap[item._id] = item.count;
      }
    });

    return res.status(200).json({
      metrics: {
        totalUsers,
        activeUsers,
        newUsersCount,
        totalPosts,
        totalReels,
        totalStories,
        totalAdminCampaigns: totalCampaigns,
        totalNotificationsSent:
          recipientStats[0]?.totalRecipients || 0,
      },
      statusBreakdown: statusMap,
      recentSignups: recentUsers.map(mapRecentUser),
      recentlySignedInUsers: recentlySignedInUsers.map(mapRecentUser),
      recentCampaigns: recentCampaigns.map(mapCampaign),
      recentAuditLogs: recentAuditLogs.map(mapAdminAuditLog),
    });
  } catch (error) {
    return next(error);
  }
};

const listUsers = async (req, res, next) => {
  try {
    const page = parsePage(req.query.page, 1);
    const limit = parseLimit(req.query.limit, 20, 50);
    const skip = (page - 1) * limit;
    const filters = buildUserFilters(req.query);

    const [users, totalCount] = await Promise.all([
      User.aggregate([
        { $match: filters },
        { $sort: { createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },
        {
          $project: {
            name: 1,
            email: 1,
            avatarUrl: 1,
            role: 1,
            accountStatus: 1,
            statusReason: 1,
            createdAt: 1,
            lastLoginAt: 1,
            followersCount: { $size: { $ifNull: ["$followers", []] } },
            followingCount: { $size: { $ifNull: ["$following", []] } },
            friendsCount: { $size: { $ifNull: ["$friends", []] } },
          },
        },
      ]),
      User.countDocuments(filters),
    ]);

    return res.status(200).json({
      users: users.map(mapAdminUserListItem),
      page,
      limit,
      totalCount,
      hasMore: skip + users.length < totalCount,
    });
  } catch (error) {
    return next(error);
  }
};

const getUserDetail = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id).populate(
      "statusUpdatedBy",
      "name email role",
    );

    if (!user) {
      throw createHttpError(404, "User not found");
    }

    const [
      postsCount,
      reelsCount,
      storiesCount,
      notificationsCount,
      unreadNotificationsCount,
      devicesCount,
      recentNotifications,
    ] = await Promise.all([
      Post.countDocuments({ author: user._id }),
      Reel.countDocuments({ author: user._id }),
      Story.countDocuments({ author: user._id }),
      Notification.countDocuments({ recipient: user._id }),
      Notification.countDocuments({ recipient: user._id, isRead: false }),
      PushToken.countDocuments({ user: user._id, isActive: true }),
      Notification.find({ recipient: user._id })
        .select("type title message category deepLink isRead createdAt")
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
    ]);

    return res.status(200).json({
      user: mapAdminUserDetail(user, {
        postsCount,
        reelsCount,
        storiesCount,
        notificationsCount,
        unreadNotificationsCount,
        activeDevicesCount: devicesCount,
        recentNotifications: recentNotifications.map(mapRecentNotification),
      }),
    });
  } catch (error) {
    return next(error);
  }
};

const updateUserStatus = async (req, res, next) => {
  try {
    const nextStatus = req.body.status;
    const reason =
      typeof req.body.reason === "string" ? req.body.reason.trim() : "";

    const user = await User.findById(req.params.id).populate(
      "statusUpdatedBy",
      "name email role",
    );

    if (!user) {
      throw createHttpError(404, "User not found");
    }

    if (user._id.toString() === req.user._id.toString()) {
      throw createHttpError(400, "You cannot change your own account status");
    }

    if (user.role === "admin") {
      throw createHttpError(400, "Admin accounts cannot be changed here");
    }

    const previousStatus = user.accountStatus || "active";
    const previousReason = user.statusReason || "";

    if (previousStatus === nextStatus && previousReason === reason) {
      return res.status(200).json({
        user: mapAdminUserDetail(user),
        message: "No status changes were required",
      });
    }

    user.accountStatus = nextStatus;
    user.statusReason = nextStatus === "active" ? "" : reason;
    user.statusUpdatedAt = new Date();
    user.statusUpdatedBy = req.user._id;
    await user.save();
    await user.populate("statusUpdatedBy", "name email role");

    await createAdminAuditLog({
      adminUserId: req.user._id.toString(),
      actionType: "user_status_changed",
      targetType: "user",
      targetId: user._id.toString(),
      metadata: {
        userName: user.name,
        userEmail: user.email,
        previousStatus,
        nextStatus,
        previousReason,
        reason: user.statusReason || "",
      },
    });

    return res.status(200).json({
      user: mapAdminUserDetail(user),
      message:
        nextStatus === "active"
          ? "User account reactivated"
          : `User account marked as ${nextStatus}`,
    });
  } catch (error) {
    return next(error);
  }
};

const getNotificationSettings = async (_req, res, next) => {
  try {
    const preferences = await getOrCreateNotificationPreferences();
    await preferences.populate("updatedBy", "name email role");

    return res.status(200).json({
      settings: mapNotificationPreferences(preferences),
    });
  } catch (error) {
    return next(error);
  }
};

const updateNotificationSettings = async (req, res, next) => {
  try {
    const updates = getNotificationPreferenceUpdates(req.body);
    if (!Object.keys(updates).length) {
      throw createHttpError(400, "No valid notification settings provided");
    }

    const preferences = await getOrCreateNotificationPreferences();
    Object.assign(preferences, updates, { updatedBy: req.user._id });
    await preferences.save();
    await preferences.populate("updatedBy", "name email role");

    return res.status(200).json({
      settings: mapNotificationPreferences(preferences),
    });
  } catch (error) {
    return next(error);
  }
};

const sendAdminMessagePushTest = async (req, res, next) => {
  try {
    const targetUserId =
      typeof req.body.userId === "string" && req.body.userId.trim()
        ? req.body.userId.trim()
        : req.user._id.toString();

    const targetUser = await User.findById(targetUserId).select("_id");
    if (!targetUser) {
      throw createHttpError(404, "Target user not found");
    }

    const result = await sendPushToUser({
      userId: targetUser._id,
      eventType: "admin_message",
      title: "Admin push test",
      body: `${req.user.name} triggered a push notification test.`,
      data: {
        type: "admin_message",
        actorId: req.user._id.toString(),
        actorName: req.user.name,
        actorAvatarUrl: req.user.avatarUrl || "",
        category: "maintenance",
        deepLink: "/(dashboard)/notifications",
        isTest: true,
      },
    });

    await createAdminAuditLog({
      adminUserId: req.user._id.toString(),
      actionType: "notification_push_test",
      targetType: "user",
      targetId: targetUser._id.toString(),
      metadata: {
        delivered: result?.delivered || 0,
        skipped: result?.skipped || "",
      },
    });

    return res.status(200).json({
      result,
      message: "Test push attempt completed",
    });
  } catch (error) {
    return next(error);
  }
};

const listNotificationHistory = async (req, res, next) => {
  try {
    const page = parsePage(req.query.page, 1);
    const limit = parseLimit(req.query.limit, 20, 50);
    const skip = (page - 1) * limit;

    const [campaigns, totalCount] = await Promise.all([
      AdminNotificationCampaign.find()
        .populate("sender", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AdminNotificationCampaign.countDocuments(),
    ]);

    return res.status(200).json({
      history: campaigns.map(mapCampaign),
      page,
      limit,
      totalCount,
      hasMore: skip + campaigns.length < totalCount,
    });
  } catch (error) {
    return next(error);
  }
};

const listAuditLogs = async (req, res, next) => {
  try {
    const page = parsePage(req.query.page, 1);
    const limit = parseLimit(req.query.limit, 20, 50);
    const skip = (page - 1) * limit;

    const [entries, totalCount] = await Promise.all([
      AdminAuditLog.find()
        .populate("adminUser", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AdminAuditLog.countDocuments(),
    ]);

    return res.status(200).json({
      auditLogs: entries.map(mapAdminAuditLog),
      page,
      limit,
      totalCount,
      hasMore: skip + entries.length < totalCount,
    });
  } catch (error) {
    return next(error);
  }
};

const sendNotificationToSingleUser = async (req, res, next) => {
  try {
    const userId = req.body.userId;

    const targetUser = await User.findOne({
      _id: userId,
      role: "user",
      ...buildActiveAccountQuery(),
    }).select("_id");

    if (!targetUser) {
      throw createHttpError(404, "Target user not found or is not active");
    }

    const result = await createAdminNotifications({
      sender: req.user,
      audienceType: "single",
      targetUserIds: [targetUser._id.toString()],
      title: req.body.title.trim(),
      body: req.body.body.trim(),
      category: req.body.category || "announcement",
      deepLink: req.body.deepLink?.trim?.() || "",
      sendPush: Boolean(req.body.sendPush),
      clientRequestId: req.body.clientRequestId || "",
    });

    return res.status(201).json({
      message: result.deduplicated
        ? "Duplicate send prevented"
        : "Notification sent",
      result: mapNotificationSendResult(result),
    });
  } catch (error) {
    return next(error);
  }
};

const sendNotificationToSelectedUsers = async (req, res, next) => {
  try {
    const userIds = Array.isArray(req.body.userIds) ? req.body.userIds : [];
    if (!userIds.length) {
      throw createHttpError(400, "Select at least one user");
    }

    const result = await createAdminNotifications({
      sender: req.user,
      audienceType: userIds.length === 1 ? "single" : "selected",
      targetUserIds: userIds,
      title: req.body.title.trim(),
      body: req.body.body.trim(),
      category: req.body.category || "announcement",
      deepLink: req.body.deepLink?.trim?.() || "",
      sendPush: Boolean(req.body.sendPush),
      clientRequestId: req.body.clientRequestId || "",
    });

    if (!result.recipientCount) {
      throw createHttpError(400, "No active user targets were eligible for this send");
    }

    return res.status(201).json({
      message: result.deduplicated
        ? "Duplicate send prevented"
        : result.queued
          ? "Notification campaign queued"
          : "Notifications sent",
      result: mapNotificationSendResult(result),
    });
  } catch (error) {
    return next(error);
  }
};

const sendNotificationToAllUsers = async (req, res, next) => {
  try {
    if (req.body.confirmAllUsers !== true) {
      throw createHttpError(
        400,
        "Mass send requires confirmAllUsers=true",
      );
    }

    const result = await createAdminNotifications({
      sender: req.user,
      audienceType: "all",
      targetUserIds: [],
      title: req.body.title.trim(),
      body: req.body.body.trim(),
      category: req.body.category || "announcement",
      deepLink: req.body.deepLink?.trim?.() || "",
      sendPush: Boolean(req.body.sendPush),
      clientRequestId: req.body.clientRequestId || "",
    });

    if (!result.recipientCount) {
      throw createHttpError(400, "No active users available to notify");
    }

    return res.status(201).json({
      message: result.deduplicated
        ? "Duplicate broadcast prevented"
        : result.queued
          ? "Broadcast queued"
          : "Broadcast sent",
      result: mapNotificationSendResult(result),
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  ADMIN_NOTIFICATION_CATEGORIES,
  getAdminSession,
  getDashboardOverview,
  getNotificationSettings,
  getUserDetail,
  listNotificationHistory,
  listAuditLogs,
  listUsers,
  loginAdmin,
  sendAdminMessagePushTest,
  sendNotificationToAllUsers,
  sendNotificationToSelectedUsers,
  sendNotificationToSingleUser,
  updateNotificationSettings,
  updateUserStatus,
};
