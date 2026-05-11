const User = require("../models/User");

const toIdString = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value._id) return value._id.toString();
  return value.toString();
};

const normalizeCommentMentions = async (rawMentions, text) => {
  if (!Array.isArray(rawMentions) || !text) {
    return [];
  }

  const requestedMentions = rawMentions
    .map((mention) => ({
      userId:
        typeof mention?.userId === "string" ? mention.userId.trim() : "",
      name: typeof mention?.name === "string" ? mention.name.trim() : "",
      start:
        Number.isInteger(mention?.start) && mention.start >= 0
          ? mention.start
          : -1,
      end:
        Number.isInteger(mention?.end) && mention.end >= 0
          ? mention.end
          : -1,
    }))
    .filter(
      (mention) =>
        mention.userId &&
        mention.name &&
        mention.start >= 0 &&
        mention.end > mention.start &&
        mention.end <= text.length &&
        text.slice(mention.start, mention.end) === `@${mention.name}`,
    );

  if (!requestedMentions.length) {
    return [];
  }

  const uniqueUserIds = [...new Set(requestedMentions.map((mention) => mention.userId))];
  const users = await User.find({ _id: { $in: uniqueUserIds } })
    .select("avatarUrl")
    .lean();
  const existingUserIds = new Set(users.map((user) => toIdString(user._id)));
  const seen = new Set();

  return requestedMentions
    .filter((mention) => {
      const key = `${mention.userId}:${mention.start}:${mention.end}`;
      if (!existingUserIds.has(mention.userId) || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.start - b.start)
    .map((mention) => ({
      user: mention.userId,
      name: mention.name,
      start: mention.start,
      end: mention.end,
    }));
};

const mapCommentMentions = (mentions = []) =>
  mentions.map((mention) => ({
    userId: mention.user ? toIdString(mention.user) : "",
    name: mention.name || mention.user?.name || "",
    avatarUrl: mention.user?.avatarUrl || "",
    start: mention.start,
    end: mention.end,
  }));

module.exports = {
  normalizeCommentMentions,
  mapCommentMentions,
};
