const PushToken = require("../models/PushToken");
const { env } = require("../config/env");
const {
  getOrCreateNotificationPreferences,
} = require("./notificationPreferences");

const EXPO_PUSH_API_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_PUSH_TOKEN_REGEX = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/;

const EVENT_TO_SETTING_FIELD = {
  chat_message: "messagePushEnabled",
  friend_request: "friendRequestPushEnabled",
  friend_accept: "friendAcceptPushEnabled",
  like_post: "likePushEnabled",
  like_reel: "likePushEnabled",
  comment_post: "commentPushEnabled",
  reply_comment: "replyPushEnabled",
  reply_reel_comment: "replyPushEnabled",
};

const isExpoPushToken = (value) =>
  typeof value === "string" && EXPO_PUSH_TOKEN_REGEX.test(value.trim());

const normalizeExpoPushToken = (value) =>
  typeof value === "string" ? value.trim() : "";

const normalizePlatform = (value) => {
  if (value === "ios" || value === "android" || value === "web") {
    return value;
  }
  return "unknown";
};

const mapPushToken = (record) => ({
  id: record._id.toString(),
  userId: record.user.toString(),
  expoPushToken: record.expoPushToken,
  platform: record.platform,
  deviceId: record.deviceId || "",
  isActive: Boolean(record.isActive),
  lastRegisteredAt: record.lastRegisteredAt,
  updatedAt: record.updatedAt,
});

const registerPushToken = async ({
  userId,
  token,
  platform,
  deviceId = "",
  deviceName = "",
  appVersion = "",
}) => {
  const normalizedToken = normalizeExpoPushToken(token);
  if (!isExpoPushToken(normalizedToken)) {
    return null;
  }

  const nextValues = {
    user: userId,
    expoPushToken: normalizedToken,
    platform: normalizePlatform(platform),
    deviceId: typeof deviceId === "string" ? deviceId.trim() : "",
    deviceName: typeof deviceName === "string" ? deviceName.trim() : "",
    appVersion: typeof appVersion === "string" ? appVersion.trim() : "",
    isActive: true,
    lastRegisteredAt: new Date(),
    lastError: "",
  };

  const record = await PushToken.findOneAndUpdate(
    { expoPushToken: normalizedToken },
    { $set: nextValues },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    },
  );

  return mapPushToken(record);
};

const deactivatePushTokens = async ({ userId, token = "", deviceId = "" }) => {
  const filters = {
    user: userId,
    isActive: true,
  };

  const normalizedToken = normalizeExpoPushToken(token);
  const normalizedDeviceId = typeof deviceId === "string" ? deviceId.trim() : "";

  if (normalizedToken) {
    filters.expoPushToken = normalizedToken;
  }
  if (normalizedDeviceId) {
    filters.deviceId = normalizedDeviceId;
  }

  if (!filters.expoPushToken && !filters.deviceId) {
    return 0;
  }

  const result = await PushToken.updateMany(
    filters,
    {
      $set: {
        isActive: false,
      },
    },
  );

  return result.modifiedCount || 0;
};

const getUserPushTokens = async (userId) => {
  const records = await PushToken.find({ user: userId }).sort({ updatedAt: -1 });
  return records.map(mapPushToken);
};

const markTokenDeliveryResult = async ({ tokenId, status, errorMessage = "" }) => {
  const update = {
    $set: {
      lastError: errorMessage,
    },
  };

  if (status === "ok") {
    update.$set.lastSentAt = new Date();
    update.$set.isActive = true;
  }

  if (errorMessage === "DeviceNotRegistered") {
    update.$set.isActive = false;
  }

  await PushToken.updateOne({ _id: tokenId }, update);
};

const sendExpoPushMessages = async (messages) => {
  if (!messages.length) {
    return [];
  }

  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  if (env.EXPO_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${env.EXPO_ACCESS_TOKEN}`;
  }

  const response = await fetch(EXPO_PUSH_API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(messages),
  });

  let json = null;
  try {
    json = await response.json();
  } catch (_error) {
    json = null;
  }

  if (!response.ok) {
    throw new Error(
      json?.errors?.[0]?.message ||
        json?.message ||
        `Expo push request failed (HTTP ${response.status})`,
    );
  }

  if (!json || !Array.isArray(json.data)) {
    throw new Error("Unexpected Expo push response");
  }

  return json.data;
};

const sendPushToUser = async ({ userId, eventType, title, body, data = {} }) => {
  const preferences = await getOrCreateNotificationPreferences();
  const eventSettingField = EVENT_TO_SETTING_FIELD[eventType];

  if (!preferences.pushEnabled) {
    return { delivered: 0, skipped: "global_push_disabled" };
  }

  if (eventSettingField && !preferences[eventSettingField]) {
    return { delivered: 0, skipped: "event_push_disabled" };
  }

  const tokens = await PushToken.find({
    user: userId,
    isActive: true,
  })
    .sort({ updatedAt: -1 })
    .limit(25);

  if (!tokens.length) {
    return { delivered: 0, skipped: "no_tokens" };
  }

  const validTokens = tokens.filter((record) => isExpoPushToken(record.expoPushToken));
  if (!validTokens.length) {
    return { delivered: 0, skipped: "no_valid_tokens" };
  }

  const messages = validTokens.map((record) => ({
    to: record.expoPushToken,
    sound: "default",
    priority: "high",
    channelId: "default",
    title,
    body,
    data,
  }));

  const tickets = await sendExpoPushMessages(messages);

  let delivered = 0;
  let attempted = 0;

  await Promise.all(
    tickets.map((ticket, index) => {
      const tokenRecord = validTokens[index];
      const status = ticket?.status === "ok" ? "ok" : "error";
      attempted += 1;

      if (status === "ok") {
        delivered += 1;
      }

      const errorMessage =
        status === "error"
          ? ticket?.details?.error || ticket?.message || "PushError"
          : "";

      return markTokenDeliveryResult({
        tokenId: tokenRecord._id,
        status,
        errorMessage,
      });
    }),
  );

  return { attempted, delivered };
};

module.exports = {
  isExpoPushToken,
  registerPushToken,
  deactivatePushTokens,
  getUserPushTokens,
  sendPushToUser,
};
