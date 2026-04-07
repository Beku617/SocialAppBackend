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
    console.warn("[push] no valid expo tokens found");
    return;
  }

  console.log("[push] sending", validTokens.length, "notification(s)");
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

    const payload = await response
      .json()
      .catch(() => null);

    if (!response.ok) {
      console.warn("[push] Expo push request failed:", payload || response.status);
      return;
    }

    const tickets = Array.isArray(payload?.data) ? payload.data : [];
    const errored = tickets
      .map((ticket, index) => ({ ticket, index }))
      .filter(({ ticket }) => ticket?.status !== "ok");

    if (errored.length > 0) {
      errored.forEach(({ ticket, index }) => {
        const details = ticket?.details ? JSON.stringify(ticket.details) : "";
        console.warn(
          "[push] ticket error for token",
          validTokens[index],
          "status",
          ticket?.status,
          "message",
          ticket?.message || "",
          details,
        );
      });
      return;
    }

    console.log("[push] Expo accepted all notifications");
  } catch (error) {
    console.warn("[push] Expo push request error:", error);
  }
};

module.exports = {
  isExpoPushToken,
  sendExpoPushNotifications,
};
