const { createHttpError } = require("./httpError");

const VISIBILITY_VALUES = ["public", "friends", "private"];
const REEL_VISIBILITY_VALUES = [...VISIBILITY_VALUES, "followers"];

const normalizeVisibilityForRead = (value, { allowFollowers = false } = {}) => {
  const normalized =
    typeof value === "string" ? value.toLowerCase().trim() : "public";

  if (normalized === "followers" && allowFollowers) {
    return "friends";
  }

  if (VISIBILITY_VALUES.includes(normalized)) {
    return normalized;
  }

  return "public";
};

const normalizeVisibilityInput = (
  value,
  {
    allowFollowers = false,
    errorMessage = "Invalid visibility",
  } = {},
) => {
  if (value === undefined || value === null || value === "") {
    return "public";
  }

  const normalized = String(value).toLowerCase().trim();
  const allowedValues = allowFollowers ? REEL_VISIBILITY_VALUES : VISIBILITY_VALUES;
  if (!allowedValues.includes(normalized)) {
    throw createHttpError(400, errorMessage);
  }

  if (normalized === "followers") {
    return "friends";
  }

  return normalized;
};

const canViewerSeeContent = ({
  visibility,
  authorId,
  viewerId,
  friendIdSet,
  allowFollowers = false,
}) => {
  const normalizedVisibility = normalizeVisibilityForRead(visibility, {
    allowFollowers,
  });

  if (!authorId) return true;
  if (authorId === viewerId) return true;
  if (normalizedVisibility === "public") return true;
  if (normalizedVisibility === "friends") {
    return Boolean(friendIdSet?.has(authorId));
  }
  return false;
};

module.exports = {
  VISIBILITY_VALUES,
  REEL_VISIBILITY_VALUES,
  normalizeVisibilityForRead,
  normalizeVisibilityInput,
  canViewerSeeContent,
};
