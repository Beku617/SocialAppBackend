const Notification = require("../models/Notification");
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
    await sendExpoPushNotifications({
      tokens: push.tokens || [],
      title,
      body,
      data: {
        ...(data || {}),
        type,
        notificationId: notification._id.toString(),
      },
      channelId: push.channelId || "messages",
    });
  }

  return notification;
};

module.exports = {
  createUserNotification,
};
