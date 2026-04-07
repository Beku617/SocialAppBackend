const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

const isExpoPushToken = (token) => {
  return (
    typeof token === "string" &&
    (token.startsWith("ExponentPushToken[") ||
      token.startsWith("ExpoPushToken["))
  );
};

const sendExpoPushNotifications = async ({
  tokens,
  title,
  body,
  data = {},
  channelId = "messages",
}) => {
  if (typeof fetch !== "function") {
    console.warn("[push] fetch is unavailable in this Node runtime");
    return;
  }

  const validTokens = Array.from(new Set((tokens || []).filter(isExpoPushToken)));
  if (validTokens.length === 0) {
    return;
  }

  const messages = validTokens.map((to) => ({
    to,
    sound: "default",
    channelId,
    priority: "high",
    ttl: 60 * 60,
    title,
    body,
    data,
  }));

  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      const text = await response.text();
      console.warn("[push] Expo push request failed:", text);
    }
  } catch (error) {
    console.warn("[push] Expo push request error:", error);
  }
};

module.exports = {
  isExpoPushToken,
  sendExpoPushNotifications,
};
