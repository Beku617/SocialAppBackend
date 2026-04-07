const path = require("path");
const fs = require("fs/promises");
const mongoose = require("mongoose");
const Reel = require("../models/Reel");
const ReelReport = require("../models/ReelReport");
const User = require("../models/User");
const { createHttpError } = require("../utils/httpError");
const { createUserNotification } = require("../utils/notificationCenter");

const ALLOWED_VISIBILITY = ["public", "friends", "followers", "private"];
const LOCAL_REEL_UPLOAD_LIMIT_BYTES = 40 * 1024 * 1024; // 40MB
const UPLOADS_ROOT = path.join(__dirname, "../../uploads");

const DEMO_REELS = [
  {
    playbackUrl: "https://samplelib.com/lib/preview/mp4/sample-5s.mp4",
    thumbUrl: "https://picsum.photos/1080/1920?random=2101",
    caption: "Exploring hidden valleys in Khentii 🏔️✨",
    music: "Mongolian Breeze · Nomadic Beats",
    likesCount: 2700000,
    commentsCount: 6043,
    repostsCount: 62700,
    sharesCount: 831000,
    savesCount: 36500,
  },
  {
    playbackUrl: "https://samplelib.com/lib/preview/mp4/sample-10s.mp4",
    thumbUrl: "https://picsum.photos/1080/1920?random=2102",
    caption: "City night rides through UB 🌃",
    music: "City Lights · Urban Mix",
    likesCount: 845000,
    commentsCount: 3211,
    repostsCount: 28400,
    sharesCount: 156000,
    savesCount: 12800,
  },
  {
    playbackUrl: "https://samplelib.com/lib/preview/mp4/sample-15s.mp4",
    thumbUrl: "https://picsum.photos/1080/1920?random=2103",
    caption: "Traditional buuz recipe, family style 🥟🔥",
    music: "Home Kitchen · Cozy Vibes",
    likesCount: 1200000,
    commentsCount: 8902,
    repostsCount: 45100,
    sharesCount: 320000,
    savesCount: 89200,
  },
  {
    playbackUrl: "https://samplelib.com/lib/preview/mp4/sample-20s.mp4",
    thumbUrl: "https://picsum.photos/1080/1920?random=2104",
    caption: "Golden hour on the steppe 🐎🌅",
    music: "Eternal Blue Sky · Morin Khuur",
    likesCount: 3100000,
    commentsCount: 12400,
    repostsCount: 98300,
    sharesCount: 1200000,
    savesCount: 67400,
  },
  {
    playbackUrl: "https://samplelib.com/lib/preview/mp4/sample-30s.mp4",
    thumbUrl: "https://picsum.photos/1080/1920?random=2105",
    caption: "Morning workout routine that actually works 💪",
    music: "Beast Mode · Workout Beats",
    likesCount: 567000,
    commentsCount: 2100,
    repostsCount: 15600,
    sharesCount: 89000,
    savesCount: 24100,
  },
];

const toIdString = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value._id) return value._id.toString();
  return value.toString();
};

const arrayHasUser = (values, userId) =>
  Array.isArray(values) && values.some((value) => toIdString(value) === userId);

const buildBlockedIdSet = (user) =>
  new Set(
    Array.isArray(user?.blockedUsers) ? user.blockedUsers.map(toIdString) : [],
  );

const canViewerSeeReel = (reel, currentUserId, friendIdSet) => {
  const authorId = toIdString(reel.author);
  if (!authorId) return false;
  if (authorId === currentUserId) return true;
  if (reel.visibility === "public") return true;
  return reel.visibility === "friends" || reel.visibility === "followers"
    ? friendIdSet.has(authorId)
    : false;
};

/**
 * Rebuild a local /uploads/ URL so it always uses the *current* request host.
 * External URLs (e.g. samplelib.com) are returned unchanged.
 */
const resolveLocalUrl = (url, storageKey, req) => {
  // If there is a storageKey that lives under our uploads folder, always
  // build the URL from the current request so it survives IP changes.
  if (
    storageKey &&
    storageKey.startsWith("reels/") &&
    !storageKey.startsWith("reels/demo/")
  ) {
    const protocol = req.protocol || "http";
    const host = req.get("host");
    return `${protocol}://${host}/uploads/${storageKey}`;
  }
  return url || "";
};

const mapReel = (reel, currentUserId, req) => {
  const authorId = toIdString(reel.author);
  const authorName = reel.author?.name || "Unknown";
  const authorAvatar = reel.author?.avatarUrl || "";
  const likesCount = Number.isFinite(reel.likesCount)
    ? reel.likesCount
    : reel.likes?.length || 0;
  const savesCount = Number.isFinite(reel.savesCount)
    ? reel.savesCount
    : reel.saves?.length || 0;
  const viewsCount = Number.isFinite(reel.viewsCount)
    ? reel.viewsCount
    : reel.viewers?.length || 0;

  const storageKey = reel.storageKey || "";
  const normalizedVisibility =
    reel.visibility === "followers" ? "friends" : reel.visibility;

  return {
    id: reel._id.toString(),
    author: {
      id: authorId,
      name: authorName,
      avatarUrl: authorAvatar,
    },
    caption: reel.caption || "",
    music: reel.music || "",
    storageKey,
    originalUrl: req
      ? resolveLocalUrl(reel.originalUrl, storageKey, req)
      : reel.originalUrl || "",
    playbackUrl: req
      ? resolveLocalUrl(reel.playbackUrl, storageKey, req)
      : reel.playbackUrl || "",
    thumbUrl: reel.thumbUrl || "",
    duration: reel.duration || 0,
    width: reel.width || 0,
    height: reel.height || 0,
    visibility: normalizedVisibility,
    status: reel.status,
    failureReason: reel.failureReason || "",
    likesCount,
    commentsCount: reel.commentsCount || 0,
    viewsCount,
    repostsCount: reel.repostsCount || 0,
    sharesCount: reel.sharesCount || 0,
    savesCount,
    likedByMe: arrayHasUser(reel.likes, currentUserId),
    savedByMe: arrayHasUser(reel.saves, currentUserId),
    ownedByMe: authorId === currentUserId,
    createdAt: reel.createdAt,
    updatedAt: reel.updatedAt,
    processedAt: reel.processedAt || null,
  };
};

const normalizeVisibility = (value) => {
  if (!value) return "public";
  const normalized = String(value).toLowerCase();
  if (!ALLOWED_VISIBILITY.includes(normalized)) {
    throw createHttpError(400, "Invalid visibility");
  }
  if (normalized === "followers") return "friends";
  return normalized;
};

const buildStorageKey = ({ userId, reelId, fileName, mimeType }) => {
  const safeName =
    typeof fileName === "string" && fileName.trim()
      ? fileName.trim()
      : "original";
  const parsed = path.parse(safeName);
  const extensionFromName = parsed.ext?.replace(".", "");
  const extensionFromMime =
    typeof mimeType === "string" && mimeType.includes("/")
      ? mimeType.split("/")[1]
      : "mp4";
  const ext = (extensionFromName || extensionFromMime || "mp4")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  return `reels/${userId}/${reelId}/original.${ext || "mp4"}`;
};

const buildUploadUrl = (storageKey) => {
  const template = process.env.REELS_UPLOAD_URL_TEMPLATE || "";
  if (!template) return "";
  return template.replace("{storageKey}", encodeURIComponent(storageKey));
};

const listReels = async (req, res, next) => {
  try {
    const currentUserId = req.user._id.toString();
    const tab = req.query.tab === "friends" ? "friends" : "reels";
    const friendIds = (req.user.friends || []).map((id) => id.toString());
    const blockedIdSet = buildBlockedIdSet(req.user);

    let visibilityFilter;
    if (tab === "friends") {
      visibilityFilter = {
        author: {
          $in: friendIds.map((id) => new mongoose.Types.ObjectId(id)),
        },
        visibility: { $in: ["public", "friends", "followers"] },
      };
    } else {
      visibilityFilter = {
        $or: [
          { author: req.user._id },
          { visibility: "public" },
          {
            author: {
              $in: friendIds.map((id) => new mongoose.Types.ObjectId(id)),
            },
            visibility: { $in: ["friends", "followers"] },
          },
        ],
      };
    }

    const reels = await Reel.find({
      status: "ready",
      storageKey: { $not: /^reels\/demo\// },
      ...visibilityFilter,
    })
      .sort({ createdAt: -1 })
      .limit(80)
      .populate("author", "name avatarUrl");

    const filteredReels = reels.filter(
      (reel) => !blockedIdSet.has(toIdString(reel.author)),
    );

    return res.status(200).json({
      reels: filteredReels.map((reel) => mapReel(reel, currentUserId, req)),
    });
  } catch (error) {
    return next(error);
  }
};

const listMyReels = async (req, res, next) => {
  try {
    const currentUserId = req.user._id.toString();
    const reels = await Reel.find({ author: req.user._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate("author", "name avatarUrl");

    return res.status(200).json({
      reels: reels.map((reel) => mapReel(reel, currentUserId, req)),
    });
  } catch (error) {
    return next(error);
  }
};

const listSavedReels = async (req, res, next) => {
  try {
    const currentUserId = req.user._id.toString();
    const friendIdSet = new Set(
      (req.user.friends || []).map((id) => id.toString()),
    );
    const blockedIdSet = buildBlockedIdSet(req.user);

    const reels = await Reel.find({
      status: "ready",
      saves: req.user._id,
    })
      .sort({ updatedAt: -1 })
      .limit(120)
      .populate("author", "name avatarUrl");

    const visibleReels = reels.filter((reel) => {
      const authorId = toIdString(reel.author);
      if (blockedIdSet.has(authorId)) return false;
      return canViewerSeeReel(reel, currentUserId, friendIdSet);
    });

    return res.status(200).json({
      reels: visibleReels.map((reel) => mapReel(reel, currentUserId, req)),
    });
  } catch (error) {
    return next(error);
  }
};

const initiateUpload = async (req, res, next) => {
  try {
    const caption =
      typeof req.body.caption === "string" ? req.body.caption.trim() : "";
    const music =
      typeof req.body.music === "string" ? req.body.music.trim() : "";
    const visibility = normalizeVisibility(req.body.visibility);
    const fileName = req.body.fileName;
    const mimeType = req.body.mimeType;

    const reel = await Reel.create({
      author: req.user._id,
      caption,
      music,
      visibility,
      status: "uploading",
    });

    const storageKey = buildStorageKey({
      userId: req.user._id.toString(),
      reelId: reel._id.toString(),
      fileName,
      mimeType,
    });

    reel.storageKey = storageKey;
    await reel.save();
    await reel.populate("author", "name avatarUrl");

    const uploadUrl = buildUploadUrl(storageKey);

    return res.status(201).json({
      reel: mapReel(reel, req.user._id.toString(), req),
      upload: {
        storageKey,
        method: "PUT",
        uploadUrl,
        headers: {
          "Content-Type": mimeType || "video/mp4",
        },
        note: uploadUrl
          ? "Use this signed URL to upload directly to object storage."
          : "Configure REELS_UPLOAD_URL_TEMPLATE to return real signed URLs.",
      },
    });
  } catch (error) {
    return next(error);
  }
};

const completeUpload = async (req, res, next) => {
  try {
    const { reelId } = req.params;
    const reel = await Reel.findById(reelId).populate(
      "author",
      "name avatarUrl",
    );

    if (!reel) {
      throw createHttpError(404, "Reel not found");
    }
    if (reel.author._id.toString() !== req.user._id.toString()) {
      throw createHttpError(403, "You can manage only your own reels");
    }

    const storageKey =
      typeof req.body.storageKey === "string" ? req.body.storageKey.trim() : "";
    const originalUrl =
      typeof req.body.originalUrl === "string"
        ? req.body.originalUrl.trim()
        : "";

    if (storageKey) {
      reel.storageKey = storageKey;
    }
    if (originalUrl) {
      reel.originalUrl = originalUrl;
    }
    reel.status = "processing";
    reel.failureReason = "";
    await reel.save();

    return res.status(200).json({
      reel: mapReel(reel, req.user._id.toString(), req),
    });
  } catch (error) {
    return next(error);
  }
};

const markReady = async (req, res, next) => {
  try {
    const { reelId } = req.params;
    const reel = await Reel.findById(reelId).populate(
      "author",
      "name avatarUrl",
    );

    if (!reel) {
      throw createHttpError(404, "Reel not found");
    }
    if (reel.author._id.toString() !== req.user._id.toString()) {
      throw createHttpError(403, "You can manage only your own reels");
    }

    reel.playbackUrl = req.body.playbackUrl.trim();
    reel.thumbUrl =
      typeof req.body.thumbUrl === "string"
        ? req.body.thumbUrl.trim()
        : reel.thumbUrl;
    reel.duration = Number.isFinite(req.body.duration)
      ? Number(req.body.duration)
      : reel.duration;
    reel.width = Number.isFinite(req.body.width)
      ? Number(req.body.width)
      : reel.width;
    reel.height = Number.isFinite(req.body.height)
      ? Number(req.body.height)
      : reel.height;
    reel.music =
      typeof req.body.music === "string" ? req.body.music.trim() : reel.music;

    reel.status = "ready";
    reel.failureReason = "";
    reel.processedAt = new Date();

    await reel.save();

    return res.status(200).json({
      reel: mapReel(reel, req.user._id.toString(), req),
    });
  } catch (error) {
    return next(error);
  }
};

const uploadLocalVideo = async (req, res, next) => {
  try {
    const { reelId } = req.params;
    const reel = await Reel.findById(reelId).populate(
      "author",
      "name avatarUrl",
    );

    if (!reel) {
      throw createHttpError(404, "Reel not found");
    }
    if (reel.author._id.toString() !== req.user._id.toString()) {
      throw createHttpError(403, "You can manage only your own reels");
    }

    const rawBase64 =
      typeof req.body.base64Data === "string" ? req.body.base64Data : "";
    if (!rawBase64) {
      throw createHttpError(400, "base64Data is required");
    }

    const mimeType =
      typeof req.body.mimeType === "string" && req.body.mimeType.trim()
        ? req.body.mimeType.trim()
        : "video/mp4";
    const fileName =
      typeof req.body.fileName === "string" && req.body.fileName.trim()
        ? req.body.fileName.trim()
        : "original.mp4";

    const payload = rawBase64.includes(",")
      ? rawBase64.slice(rawBase64.indexOf(",") + 1)
      : rawBase64;

    const buffer = Buffer.from(payload, "base64");
    if (!buffer.length) {
      throw createHttpError(400, "Invalid base64Data");
    }
    if (buffer.length > LOCAL_REEL_UPLOAD_LIMIT_BYTES) {
      throw createHttpError(413, "Video too large. Max allowed is 40MB");
    }

    const storageKey = buildStorageKey({
      userId: req.user._id.toString(),
      reelId: reel._id.toString(),
      fileName,
      mimeType,
    }).replace(/\\/g, "/");

    const absolutePath = path.join(UPLOADS_ROOT, storageKey);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, buffer);

    const host = req.get("host");
    const protocol = req.protocol || "http";
    const videoUrl = `${protocol}://${host}/uploads/${storageKey}`;

    reel.storageKey = storageKey;
    reel.originalUrl = videoUrl;
    await reel.save();

    return res.status(200).json({
      storageKey,
      videoUrl,
      reel: mapReel(reel, req.user._id.toString(), req),
    });
  } catch (error) {
    return next(error);
  }
};

const markFailed = async (req, res, next) => {
  try {
    const { reelId } = req.params;
    const reel = await Reel.findById(reelId).populate(
      "author",
      "name avatarUrl",
    );

    if (!reel) {
      throw createHttpError(404, "Reel not found");
    }
    if (reel.author._id.toString() !== req.user._id.toString()) {
      throw createHttpError(403, "You can manage only your own reels");
    }

    const failureReason =
      typeof req.body.failureReason === "string"
        ? req.body.failureReason.trim()
        : "";

    reel.status = "failed";
    reel.failureReason = failureReason || "Processing failed";
    await reel.save();

    return res.status(200).json({
      reel: mapReel(reel, req.user._id.toString(), req),
    });
  } catch (error) {
    return next(error);
  }
};

const updateReel = async (req, res, next) => {
  try {
    const { reelId } = req.params;
    const reel = await Reel.findById(reelId).populate(
      "author",
      "name avatarUrl",
    );

    if (!reel) {
      throw createHttpError(404, "Reel not found");
    }
    if (reel.author._id.toString() !== req.user._id.toString()) {
      throw createHttpError(403, "You can manage only your own reels");
    }

    if (typeof req.body.caption === "string") {
      reel.caption = req.body.caption.trim();
    }
    if (typeof req.body.music === "string") {
      reel.music = req.body.music.trim();
    }
    if (typeof req.body.visibility === "string") {
      reel.visibility = normalizeVisibility(req.body.visibility);
    }
    if (typeof req.body.thumbUrl === "string") {
      reel.thumbUrl = req.body.thumbUrl.trim();
    }

    await reel.save();

    return res.status(200).json({
      reel: mapReel(reel, req.user._id.toString(), req),
    });
  } catch (error) {
    return next(error);
  }
};

const deleteReel = async (req, res, next) => {
  try {
    const { reelId } = req.params;
    const reel = await Reel.findById(reelId);

    if (!reel) {
      throw createHttpError(404, "Reel not found");
    }
    if (reel.author.toString() !== req.user._id.toString()) {
      throw createHttpError(403, "You can delete only your own reels");
    }

    await Reel.deleteOne({ _id: reelId });
    return res.status(200).json({ message: "Reel deleted" });
  } catch (error) {
    return next(error);
  }
};

const toggleLike = async (req, res, next) => {
  try {
    const { reelId } = req.params;
    const userId = req.user._id.toString();
    const blockedIdSet = buildBlockedIdSet(req.user);
    const reel = await Reel.findById(reelId);

    if (!reel || reel.status !== "ready") {
      throw createHttpError(404, "Reel not found");
    }
    if (blockedIdSet.has(reel.author.toString())) {
      throw createHttpError(403, "Action not allowed");
    }

    const currentIndex = reel.likes.findIndex((id) => id.toString() === userId);
    const liked = currentIndex === -1;

    if (liked) {
      reel.likes.push(new mongoose.Types.ObjectId(userId));
    } else {
      reel.likes.splice(currentIndex, 1);
    }
    reel.likesCount = reel.likes.length;
    await reel.save();

    const authorId = reel.author.toString();
    if (liked && authorId !== userId) {
      try {
        const reelAuthor = await User.findById(authorId).select(
          "expoPushTokens",
        );
        await createUserNotification({
          userId: authorId,
          type: "reel_like",
          title: `${req.user?.name || "Someone"} liked your reel`,
          body: reel.caption
            ? reel.caption.slice(0, 120)
            : "Someone reacted to your reel.",
          data: {
            type: "reel_like",
            reelId: reel._id.toString(),
            actorId: userId,
            actorName: req.user?.name || "",
          },
          push: {
            enabled: true,
            tokens: reelAuthor?.expoPushTokens || [],
            channelId: "messages",
          },
        });
      } catch (notificationError) {
        console.warn("[reel_like] notification dispatch failed:", notificationError);
      }
    }

    return res.status(200).json({
      liked,
      likeCount: reel.likesCount,
    });
  } catch (error) {
    return next(error);
  }
};

const toggleSave = async (req, res, next) => {
  try {
    const { reelId } = req.params;
    const userId = req.user._id.toString();
    const blockedIdSet = buildBlockedIdSet(req.user);
    const reel = await Reel.findById(reelId);

    if (!reel || reel.status !== "ready") {
      throw createHttpError(404, "Reel not found");
    }
    if (blockedIdSet.has(reel.author.toString())) {
      throw createHttpError(403, "Action not allowed");
    }

    const currentIndex = reel.saves.findIndex((id) => id.toString() === userId);
    const saved = currentIndex === -1;

    if (saved) {
      reel.saves.push(new mongoose.Types.ObjectId(userId));
    } else {
      reel.saves.splice(currentIndex, 1);
    }
    reel.savesCount = reel.saves.length;
    await reel.save();

    return res.status(200).json({
      saved,
      savesCount: reel.savesCount,
    });
  } catch (error) {
    return next(error);
  }
};

const trackView = async (req, res, next) => {
  try {
    const { reelId } = req.params;
    const userId = req.user._id.toString();
    const blockedIdSet = buildBlockedIdSet(req.user);
    const reel = await Reel.findById(reelId);

    if (!reel || reel.status !== "ready") {
      throw createHttpError(404, "Reel not found");
    }
    if (blockedIdSet.has(reel.author.toString())) {
      throw createHttpError(403, "Action not allowed");
    }

    const alreadyViewed = reel.viewers.some((id) => id.toString() === userId);
    if (!alreadyViewed) {
      reel.viewers.push(new mongoose.Types.ObjectId(userId));
      reel.viewsCount = reel.viewers.length;
      await reel.save();
    }

    return res.status(200).json({
      viewed: true,
      viewsCount: reel.viewsCount || reel.viewers.length,
    });
  } catch (error) {
    return next(error);
  }
};

const reportReel = async (req, res, next) => {
  try {
    const { reelId } = req.params;
    const reason =
      typeof req.body?.reason === "string" && req.body.reason.trim()
        ? req.body.reason.trim()
        : "other";
    const description =
      typeof req.body?.description === "string"
        ? req.body.description.trim()
        : "";

    const allowedReasons = [
      "spam",
      "harassment",
      "hate_speech",
      "violence",
      "nudity",
      "false_information",
      "other",
    ];
    if (!allowedReasons.includes(reason)) {
      throw createHttpError(400, "Invalid report reason");
    }

    const reel = await Reel.findById(reelId).select("_id author status visibility");
    if (!reel || reel.status !== "ready") {
      throw createHttpError(404, "Reel not found");
    }

    const currentUserId = req.user._id.toString();
    const friendIdSet = new Set(
      (req.user.friends || []).map((id) => id.toString()),
    );
    const blockedIdSet = buildBlockedIdSet(req.user);
    const authorId = toIdString(reel.author);

    if (blockedIdSet.has(authorId)) {
      throw createHttpError(403, "Action not allowed");
    }
    if (!canViewerSeeReel(reel, currentUserId, friendIdSet)) {
      throw createHttpError(403, "You cannot report this reel");
    }

    try {
      await ReelReport.create({
        reel: reel._id,
        reporter: req.user._id,
        reason,
        description,
        status: "open",
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }

    return res.status(201).json({ message: "Reel reported" });
  } catch (error) {
    return next(error);
  }
};

const seedReels = async (req, res, next) => {
  try {
    const existing = await Reel.countDocuments({ status: "ready" });
    if (existing > 0) {
      return res
        .status(200)
        .json({ message: "Reels already seeded", count: existing });
    }

    const users = await User.find().select("_id").limit(10).lean();
    if (!users.length) {
      throw createHttpError(
        400,
        "Create at least one user before seeding reels",
      );
    }

    const authorIds = [
      req.user._id.toString(),
      ...users.map((u) => u._id.toString()),
    ];
    const uniqueAuthorIds = [...new Set(authorIds)];

    const reelsToInsert = DEMO_REELS.map((item, index) => ({
      author: uniqueAuthorIds[index % uniqueAuthorIds.length],
      caption: item.caption,
      music: item.music,
      storageKey: `reels/demo/demo-${index + 1}/original.mp4`,
      originalUrl: item.playbackUrl,
      playbackUrl: item.playbackUrl,
      thumbUrl: item.thumbUrl,
      duration: 12 + index * 2,
      width: 1080,
      height: 1920,
      visibility: "public",
      status: "ready",
      likesCount: item.likesCount,
      commentsCount: item.commentsCount,
      repostsCount: item.repostsCount,
      sharesCount: item.sharesCount,
      savesCount: item.savesCount,
      viewsCount: Math.max(item.likesCount, 1),
      processedAt: new Date(),
    }));

    await Reel.insertMany(reelsToInsert);
    const count = await Reel.countDocuments({ status: "ready" });

    return res.status(201).json({ message: "Reels seeded", count });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  completeUpload,
  deleteReel,
  initiateUpload,
  listMyReels,
  listSavedReels,
  listReels,
  markFailed,
  markReady,
  reportReel,
  seedReels,
  toggleLike,
  toggleSave,
  trackView,
  uploadLocalVideo,
  updateReel,
};
