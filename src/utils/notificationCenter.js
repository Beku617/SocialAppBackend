const Notification = require("../models/Notification");
const User = require("../models/User");
const { sendExpoPushNotifications } = require("./pushNotifications");

const createUserNotification = async ({
  userId,
  type,
  title,
  body,
  data = {},
  push = {},
}) => {
  const notification = await Notification.create({
    user: userId,
    type,
    title,
    body,
    data,
    read: false,
  });

  if (push.enabled) {
    const unreadCount = await Notification.countDocuments({
      user: userId,
      read: false,
    });

    const pushResult = await sendExpoPushNotifications({
      tokens: push.tokens || [],
      title,
      body,
      data: {
        ...(data || {}),
        type,
        notificationId: notification._id.toString(),
      },
      channelId: push.channelId || "messages",
      badge: unreadCount,
    });

    const invalidTokens = Array.isArray(pushResult?.invalidTokens)
      ? pushResult.invalidTokens
      : [];

    if (invalidTokens.length > 0) {
      await User.updateOne(
        { _id: userId },
        { $pull: { expoPushTokens: { $in: invalidTokens } } },
      );
      console.log(
        "[push] removed invalid Expo push tokens for user",
        String(userId),
        invalidTokens,
      );
    }
  }

  return notification;
};

module.exports = {
  createUserNotification,
};
