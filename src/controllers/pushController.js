const { createHttpError } = require("../utils/httpError");
const {
  deactivatePushTokens,
  getUserPushTokens,
  isExpoPushToken,
  registerPushToken,
} = require("../utils/pushNotifications");

const registerDevicePushToken = async (req, res, next) => {
  try {
    const token = typeof req.body.token === "string" ? req.body.token.trim() : "";

    if (!isExpoPushToken(token)) {
      throw createHttpError(400, "Invalid Expo push token");
    }

    const savedToken = await registerPushToken({
      userId: req.user._id,
      token,
      platform: req.body.platform,
      deviceId: req.body.deviceId,
      deviceName: req.body.deviceName,
      appVersion: req.body.appVersion,
    });

    return res.status(200).json({
      token: savedToken,
      message: "Push token registered",
    });
  } catch (error) {
    return next(error);
  }
};

const unregisterDevicePushToken = async (req, res, next) => {
  try {
    const token = typeof req.body.token === "string" ? req.body.token.trim() : "";
    const deviceId =
      typeof req.body.deviceId === "string" ? req.body.deviceId.trim() : "";

    if (!token && !deviceId) {
      throw createHttpError(400, "token or deviceId is required");
    }

    const deactivatedCount = await deactivatePushTokens({
      userId: req.user._id,
      token,
      deviceId,
    });

    return res.status(200).json({
      deactivatedCount,
      message: "Push token deactivated",
    });
  } catch (error) {
    return next(error);
  }
};

const listMyPushTokens = async (req, res, next) => {
  try {
    const tokens = await getUserPushTokens(req.user._id);
    return res.status(200).json({ tokens });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  listMyPushTokens,
  registerDevicePushToken,
  unregisterDevicePushToken,
};
