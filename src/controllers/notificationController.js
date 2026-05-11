const Notification = require("../models/Notification");
const { createHttpError } = require("../utils/httpError");
const { toIdString } = require("../utils/notifications");

const mapNotification = (notification) => {
  const actorId = notification.actor ? toIdString(notification.actor) : "";

  return {
    id: notification._id.toString(),
    type: notification.type,
    title: notification.title || "",
    message: notification.message,
    category: notification.category || "activity",
    isRead: Boolean(notification.isRead),
    createdAt: notification.createdAt,
    actor: {
      id: actorId,
      name: notification.actor?.name || notification.actorName || "Unknown user",
      avatarUrl: notification.actor?.avatarUrl || notification.actorAvatarUrl || "",
    },
    target: {
      userId:
        notification.type === "chat_message" ||
        notification.type === "follow" ||
        notification.type === "friend_request" ||
        notification.type === "friend_accept"
          ? actorId
          : null,
      postId: notification.post ? notification.post.toString() : null,
      reelId: notification.reel ? notification.reel.toString() : null,
      referenceId: notification.referenceId || null,
      deepLink: notification.deepLink || null,
    },
  };
};

const listNotifications = async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const [notifications, totalCount, unreadCount] = await Promise.all([
      Notification.find({ recipient: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("actor", "name avatarUrl")
        .lean(),
      Notification.countDocuments({ recipient: req.user._id }),
      Notification.countDocuments({ recipient: req.user._id, isRead: false }),
    ]);

    return res.status(200).json({
      notifications: notifications.map(mapNotification),
      unreadCount,
      page,
      hasMore: skip + notifications.length < totalCount,
    });
  } catch (error) {
    return next(error);
  }
};

const getUnreadNotificationsCount = async (req, res, next) => {
  try {
    const unreadCount = await Notification.countDocuments({
      recipient: req.user._id,
      isRead: false,
    });

    return res.status(200).json({ unreadCount });
  } catch (error) {
    return next(error);
  }
};

const markNotificationRead = async (req, res, next) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      recipient: req.user._id,
    });

    if (!notification) {
      throw createHttpError(404, "Notification not found");
    }

    if (!notification.isRead) {
      notification.isRead = true;
      notification.readAt = new Date();
      await notification.save();
    }

    const unreadCount = await Notification.countDocuments({
      recipient: req.user._id,
      isRead: false,
    });

    return res.status(200).json({
      notification: mapNotification(notification),
      unreadCount,
    });
  } catch (error) {
    return next(error);
  }
};

const markAllNotificationsRead = async (req, res, next) => {
  try {
    await Notification.updateMany(
      { recipient: req.user._id, isRead: false },
      { $set: { isRead: true, readAt: new Date() } },
    );

    return res.status(200).json({
      message: "Notifications marked as read",
      unreadCount: 0,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getUnreadNotificationsCount,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
};
