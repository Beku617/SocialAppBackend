const Notification = require("../models/Notification");
const { createHttpError } = require("../utils/httpError");

const ACTIVITY_NOTIFICATION_TYPES = [
  "post_like",
  "post_comment",
  "reel_like",
  "reel_comment",
  "admin_broadcast",
  "friend_request",
  "friend_request_accepted",
];

const serializeNotification = (notification) => ({
  id: notification._id.toString(),
  type: notification.type,
  title: notification.title,
  body: notification.body,
  data: notification.data || {},
  read: Boolean(notification.read),
  createdAt: notification.createdAt,
});

const listNotifications = async (req, res, next) => {
  try {
    const notifications = await Notification.find({
      user: req.user._id,
      type: { $in: ACTIVITY_NOTIFICATION_TYPES },
    })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    return res.status(200).json({
      notifications: notifications.map(serializeNotification),
    });
  } catch (error) {
    return next(error);
  }
};

const markNotificationRead = async (req, res, next) => {
  try {
    const { notificationId } = req.params;
    const notification = await Notification.findOneAndUpdate(
      {
        _id: notificationId,
        user: req.user._id,
      },
      { $set: { read: true } },
      { new: true },
    ).lean();

    if (!notification) {
      throw createHttpError(404, "Notification not found");
    }

    return res.status(200).json({ notification: serializeNotification(notification) });
  } catch (error) {
    return next(error);
  }
};

const markAllNotificationsRead = async (req, res, next) => {
  try {
    await Notification.updateMany(
      {
        user: req.user._id,
        read: false,
        type: { $in: ACTIVITY_NOTIFICATION_TYPES },
      },
      { $set: { read: true } },
    );
    return res.status(200).json({ ok: true });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
};
