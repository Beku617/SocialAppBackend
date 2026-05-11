const NotificationPreference = require("../models/NotificationPreference");

const DEFAULT_NOTIFICATION_PREFERENCES = {
  pushEnabled: true,
  messagePushEnabled: true,
  friendRequestPushEnabled: true,
  friendAcceptPushEnabled: true,
  likePushEnabled: true,
  commentPushEnabled: true,
  replyPushEnabled: true,
};

const ALLOWED_NOTIFICATION_FIELDS = Object.keys(DEFAULT_NOTIFICATION_PREFERENCES);

const getOrCreateNotificationPreferences = async () =>
  NotificationPreference.findOneAndUpdate(
    { scope: "global" },
    {
      $setOnInsert: {
        scope: "global",
        ...DEFAULT_NOTIFICATION_PREFERENCES,
      },
    },
    {
      new: true,
      upsert: true,
    },
  );

const getNotificationPreferenceUpdates = (payload = {}) => {
  const updates = {};

  ALLOWED_NOTIFICATION_FIELDS.forEach((field) => {
    if (typeof payload[field] === "boolean") {
      updates[field] = payload[field];
    }
  });

  return updates;
};

module.exports = {
  ALLOWED_NOTIFICATION_FIELDS,
  DEFAULT_NOTIFICATION_PREFERENCES,
  getNotificationPreferenceUpdates,
  getOrCreateNotificationPreferences,
};
