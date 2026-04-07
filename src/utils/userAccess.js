const { createHttpError } = require("./httpError");

const BAN_DURATIONS = {
  "1d": 1 * 24 * 60 * 60 * 1000,
  "3d": 3 * 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

const BAN_DURATION_OPTIONS = ["1d", "3d", "7d", "30d", "forever"];

const clearBanFields = (user) => {
  user.bannedAt = null;
  user.banExpiresAt = null;
  user.banIsPermanent = false;
};

const isUserCurrentlyBanned = (user) => {
  if (!user) return false;
  if (user.banIsPermanent) return true;
  if (!user.banExpiresAt) return false;
  return new Date(user.banExpiresAt).getTime() > Date.now();
};

const buildBanSnapshot = (user) => {
  const active = isUserCurrentlyBanned(user);

  return {
    active,
    permanent: Boolean(user?.banIsPermanent),
    expiresAt: user?.banExpiresAt
      ? new Date(user.banExpiresAt).toISOString()
      : null,
    label: active
      ? user?.banIsPermanent
        ? "Forever"
        : "Temporary"
      : "Active",
  };
};

const syncExpiredBanState = async (user) => {
  if (!user || user.banIsPermanent || !user.banExpiresAt) {
    return user;
  }

  if (new Date(user.banExpiresAt).getTime() > Date.now()) {
    return user;
  }

  clearBanFields(user);
  await user.save();
  return user;
};

const getBanMessage = (user) => {
  if (user?.banIsPermanent) {
    return "Your account has been banned permanently";
  }

  if (user?.banExpiresAt) {
    return `Your account is banned until ${new Date(user.banExpiresAt).toISOString()}`;
  }

  return "Your account is banned";
};

const ensureUserCanAccess = async (user) => {
  await syncExpiredBanState(user);

  if (isUserCurrentlyBanned(user)) {
    throw createHttpError(403, getBanMessage(user));
  }

  return user;
};

const applyBanToUser = async (user, durationKey) => {
  user.bannedAt = new Date();

  if (durationKey === "forever") {
    user.banIsPermanent = true;
    user.banExpiresAt = null;
  } else {
    user.banIsPermanent = false;
    user.banExpiresAt = new Date(Date.now() + BAN_DURATIONS[durationKey]);
  }

  await user.save();
  return user;
};

const clearUserBan = async (user) => {
  clearBanFields(user);
  await user.save();
  return user;
};

module.exports = {
  BAN_DURATION_OPTIONS,
  applyBanToUser,
  buildBanSnapshot,
  clearBanFields,
  clearUserBan,
  ensureUserCanAccess,
  getBanMessage,
  isUserCurrentlyBanned,
  syncExpiredBanState,
};
