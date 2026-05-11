const mongoose = require("mongoose");
const Reel = require("../models/Reel");
const ReelReport = require("../models/ReelReport");
const User = require("../models/User");
const Notification = require("../models/Notification");
const { createHttpError } = require("../utils/httpError");
const { createUserNotification } = require("../utils/notificationCenter");
const {
  canViewerSeeContent,
  normalizeVisibilityForRead,
  normalizeVisibilityInput,
} = require("../utils/visibility");
const cloudinary = require("../config/cloudinary");
const { env } = require("../config/env");
const REEL_UPLOAD_LIMIT_BYTES = 40 * 1024 * 1024; // 40MB
const CLOUDINARY_UPLOAD_TIMEOUT_MS = Math.max(
  Number(env.REELS_UPLOAD_TIMEOUT_MS) || 0,
  120000,
);
const CLOUDINARY_UPLOAD_CHUNK_SIZE = 6000000;
const CLOUDINARY_UPLOAD_MAX_ATTEMPTS = 3;
const CLOUDINARY_UPLOAD_RETRY_BASE_DELAY_MS = 1000;

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
  return canViewerSeeContent({
    visibility: reel?.visibility,
    authorId: toIdString(reel?.author),
    viewerId: currentUserId,
    friendIdSet,
    allowFollowers: true,
  });
};

const mapReel = (reel, currentUserId) => {
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
  const normalizedVisibility = normalizeVisibilityForRead(reel.visibility, {
    allowFollowers: true,
  });

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
    originalUrl: reel.originalUrl || "",
    playbackUrl: reel.playbackUrl || "",
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
  return normalizeVisibilityInput(value, {
    allowFollowers: true,
    errorMessage: "Invalid visibility",
  });
};

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const isCloudinaryTimeoutError = (error) => {
  if (!error) return false;

  const message = String(error.message || "").toLowerCase();
  const name = String(error.name || "").toLowerCase();
  const httpCode = Number(error.http_code || error.httpCode || error.statusCode);

  return (
    httpCode === 499 ||
    httpCode === 504 ||
    name.includes("timeout") ||
    message.includes("request timeout") ||
    message.includes("timed out") ||
    message.includes("etimedout")
  );
};

const isRetryableCloudinaryError = (error) => {
  if (!error) return false;
  if (isCloudinaryTimeoutError(error)) return true;

  const message = String(error.message || "").toLowerCase();
  const httpCode = Number(error.http_code || error.httpCode || error.statusCode);

  return (
    !httpCode ||
    httpCode >= 500 ||
    message.includes("econnreset") ||
    message.includes("socket hang up") ||
    message.includes("network")
  );
};

const mapCloudinaryUploadError = (error, attempts) => {
  const message = error?.message || "unknown error";
  const retryable = isRetryableCloudinaryError(error);

  if (isCloudinaryTimeoutError(error)) {
    return createHttpError(
      504,
      `Video upload to Cloudinary timed out after ${CLOUDINARY_UPLOAD_TIMEOUT_MS}ms. Please retry.`,
      {
        code: "CLOUDINARY_UPLOAD_TIMEOUT",
        attempts,
        retryable,
        upstreamMessage: message,
      },
    );
  }

  return createHttpError(
    502,
    "Video upload to Cloudinary failed. Please retry.",
    {
      code: "CLOUDINARY_UPLOAD_FAILED",
      attempts,
      retryable,
      upstreamMessage: message,
    },
  );
};

const isCloudinaryConfigured = () =>
  Boolean(
    env.CLOUDINARY_CLOUD_NAME &&
      env.CLOUDINARY_API_KEY &&
      env.CLOUDINARY_API_SECRET,
  );

const buildCloudinaryPublicId = ({ userId, reelId }) =>
  `${userId}/${reelId}/original`;
const buildCloudinaryUploadPublicId = ({ userId, reelId }) =>
  `reels/${buildCloudinaryPublicId({ userId, reelId })}`;

const buildStorageKeyFromPublicId = (publicId) => `cloudinary:${publicId}`;

const pickFirstNonEmptyString = (...values) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
};

const uploadVideoBufferToCloudinary = async ({
  buffer,
  mimeType,
  fileName,
  userId,
  reelId,
}) => {
  if (!isCloudinaryConfigured()) {
    throw createHttpError(
      500,
      "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.",
    );
  }

  const publicId = buildCloudinaryPublicId({ userId, reelId });
  const formatFromMime =
    typeof mimeType === "string" && mimeType.includes("/")
      ? mimeType.split("/")[1].toLowerCase()
      : "";
  const uploadOptions = {
    resource_type: "video",
    folder: "reels",
    public_id: publicId,
    overwrite: true,
    quality: "auto",
    fetch_format: "auto",
    timeout: CLOUDINARY_UPLOAD_TIMEOUT_MS,
    chunk_size: CLOUDINARY_UPLOAD_CHUNK_SIZE,
    ...(fileName ? { filename: fileName } : {}),
    ...(formatFromMime ? { format: formatFromMime } : {}),
    eager: [
      {
        format: "jpg",
        width: 720,
        crop: "limit",
        start_offset: "1",
      },
    ],
  };

  let lastError;

  for (let attempt = 1; attempt <= CLOUDINARY_UPLOAD_MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_chunked_stream(
          uploadOptions,
          (error, uploaded) => {
            if (error) {
              return reject(error);
            }
            if (!uploaded) {
              return reject(new Error("Cloudinary upload failed: empty response."));
            }
            return resolve(uploaded);
          },
        );

        uploadStream.on("error", reject);
        uploadStream.end(buffer);
      });

      return result;
    } catch (error) {
      lastError = error;
      const retryable = isRetryableCloudinaryError(error);

      console.warn("[reels] cloudinary upload attempt failed", {
        reelId,
        attempt,
        maxAttempts: CLOUDINARY_UPLOAD_MAX_ATTEMPTS,
        timeoutMs: CLOUDINARY_UPLOAD_TIMEOUT_MS,
        chunkSize: CLOUDINARY_UPLOAD_CHUNK_SIZE,
        error: error?.message || String(error),
        timeout: isCloudinaryTimeoutError(error),
        retryable,
      });

      if (retryable && attempt < CLOUDINARY_UPLOAD_MAX_ATTEMPTS) {
        await sleep(CLOUDINARY_UPLOAD_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
        continue;
      }

      break;
    }
  }

  throw mapCloudinaryUploadError(lastError, CLOUDINARY_UPLOAD_MAX_ATTEMPTS);
};

const getCloudinaryPublicIdFromReel = (reel) => {
  if (typeof reel.cloudinaryPublicId === "string" && reel.cloudinaryPublicId.trim()) {
    return reel.cloudinaryPublicId.trim();
  }
  if (typeof reel.storageKey === "string" && reel.storageKey.startsWith("cloudinary:")) {
    return reel.storageKey.replace("cloudinary:", "").trim();
  }
  return "";
};

const deleteCloudinaryVideo = async (publicId) => {
  if (!publicId || !isCloudinaryConfigured()) return;

  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: "video" });
  } catch (error) {
    console.warn("[reels] failed to delete Cloudinary asset", {
      publicId,
      error: error?.message || String(error),
    });
  }
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
      reels: filteredReels.map((reel) => mapReel(reel, currentUserId)),
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
      reels: reels.map((reel) => mapReel(reel, currentUserId)),
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
      reels: visibleReels.map((reel) => mapReel(reel, currentUserId)),
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

    const reel = await Reel.create({
      author: req.user._id,
      caption,
      music,
      visibility,
      status: "uploading",
    });

    const cloudinaryPublicId = buildCloudinaryUploadPublicId({
      userId: req.user._id.toString(),
      reelId: reel._id.toString(),
    });
    const storageKey = buildStorageKeyFromPublicId(cloudinaryPublicId);

    reel.cloudinaryPublicId = cloudinaryPublicId;
    reel.storageKey = storageKey;
    await reel.save();
    await reel.populate("author", "name avatarUrl");

    return res.status(201).json({
      reel: mapReel(reel, req.user._id.toString()),
      upload: {
        storageKey,
        cloudinaryPublicId,
        method: "PUT",
        uploadUrl: "",
        headers: {
          "Content-Type": "video/mp4",
        },
        note: "Upload media through /api/reels/:reelId/uploads/local. Server stores it in Cloudinary.",
      },
    });
  } catch (error) {
    return next(error);
  }
};

const signUpload = async (req, res, next) => {
  try {
    if (!isCloudinaryConfigured()) {
      throw createHttpError(
        500,
        "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.",
      );
    }

    const reelId = req.body?.reelId;
    const reel = await Reel.findById(reelId).select("_id author");

    if (!reel) {
      throw createHttpError(404, "Reel not found");
    }
    if (reel.author.toString() !== req.user._id.toString()) {
      throw createHttpError(403, "You can manage only your own reels");
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const uploadPreset =
      typeof env.CLOUDINARY_REELS_UPLOAD_PRESET === "string"
        ? env.CLOUDINARY_REELS_UPLOAD_PRESET.trim()
        : "";
    const publicId = buildCloudinaryUploadPublicId({
      userId: req.user._id.toString(),
      reelId: reel._id.toString(),
    });
    const paramsToSign = {
      timestamp,
      public_id: publicId,
      overwrite: "true",
      ...(uploadPreset ? { upload_preset: uploadPreset } : {}),
    };
    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      env.CLOUDINARY_API_SECRET,
    );

    return res.status(200).json({
      signature,
      timestamp,
      cloudName: env.CLOUDINARY_CLOUD_NAME,
      apiKey: env.CLOUDINARY_API_KEY,
      uploadPreset,
      publicId,
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

    const publicId = pickFirstNonEmptyString(
      req.body?.public_id,
      req.body?.publicId,
      req.body?.cloudinaryPublicId,
    );
    const secureUrl = pickFirstNonEmptyString(
      req.body?.secure_url,
      req.body?.secureUrl,
      req.body?.originalUrl,
    );
    const thumbUrl = pickFirstNonEmptyString(req.body?.thumb_url, req.body?.thumbUrl);

    if ((publicId && !secureUrl) || (!publicId && secureUrl)) {
      throw createHttpError(
        400,
        "Both public_id and secure_url are required to complete direct upload.",
      );
    }

    if (publicId && secureUrl) {
      const expectedPrefix = `reels/${req.user._id.toString()}/${reel._id.toString()}/`;
      if (!publicId.startsWith(expectedPrefix)) {
        throw createHttpError(400, "Invalid Cloudinary public_id for this reel.");
      }

      reel.cloudinaryPublicId = publicId;
      reel.storageKey = buildStorageKeyFromPublicId(publicId);
      reel.originalUrl = secureUrl;
      reel.playbackUrl = secureUrl;
      if (thumbUrl) {
        reel.thumbUrl = thumbUrl;
      }
    }

    if (!reel.originalUrl || !getCloudinaryPublicIdFromReel(reel)) {
      throw createHttpError(
        400,
        "Cloudinary upload is not completed for this reel yet.",
      );
    }

    if (reel.status !== "ready") {
      reel.status = "processing";
    }
    reel.failureReason = "";
    await reel.save();

    return res.status(200).json({
      reel: mapReel(reel, req.user._id.toString()),
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

    reel.playbackUrl =
      typeof reel.originalUrl === "string" && reel.originalUrl.trim()
        ? reel.originalUrl.trim()
        : req.body.playbackUrl.trim();
    if (typeof req.body.thumbUrl === "string" && req.body.thumbUrl.trim()) {
      reel.thumbUrl = req.body.thumbUrl.trim();
    }
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

    const ownerId = req.user._id.toString();
    const reelIdValue = reel._id.toString();
    const existingNotification = await Notification.findOne({
      user: req.user._id,
      type: "reel_upload_complete",
      "data.reelId": reelIdValue,
    }).lean();

    if (!existingNotification) {
      const owner = await User.findById(ownerId).select("expoPushTokens");
      await createUserNotification({
        userId: ownerId,
        type: "reel_upload_complete",
        title: "Reel upload complete",
        body: reel.caption
          ? `Your reel is ready: ${reel.caption.slice(0, 120)}`
          : "Your reel is now ready to watch.",
        data: {
          type: "reel_upload_complete",
          reelId: reelIdValue,
        },
        push: {
          enabled: false,
          tokens: owner?.expoPushTokens || [],
          channelId: "messages",
        },
      });
    }

    return res.status(200).json({
      reel: mapReel(reel, req.user._id.toString()),
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

    const multipartBuffer = req.file?.buffer;
    const rawBase64 =
      typeof req.body.base64Data === "string" ? req.body.base64Data : "";
    const hasMultipartVideo = Boolean(multipartBuffer?.length);
    const hasBase64Video = Boolean(rawBase64.trim());

    if (!hasMultipartVideo && !hasBase64Video) {
      throw createHttpError(400, "Provide multipart video file or base64Data");
    }

    let buffer;
    let mimeType;
    let fileName;

    if (hasMultipartVideo) {
      buffer = multipartBuffer;
      mimeType =
        (typeof req.file?.mimetype === "string" && req.file.mimetype.trim()) ||
        (typeof req.body.mimeType === "string" && req.body.mimeType.trim()) ||
        "video/mp4";
      fileName =
        (typeof req.file?.originalname === "string" &&
          req.file.originalname.trim()) ||
        (typeof req.body.fileName === "string" && req.body.fileName.trim()) ||
        "original.mp4";
    } else {
      const payload = rawBase64.includes(",")
        ? rawBase64.slice(rawBase64.indexOf(",") + 1)
        : rawBase64;

      buffer = Buffer.from(payload, "base64");
      mimeType =
        typeof req.body.mimeType === "string" && req.body.mimeType.trim()
          ? req.body.mimeType.trim()
          : "video/mp4";
      fileName =
        typeof req.body.fileName === "string" && req.body.fileName.trim()
          ? req.body.fileName.trim()
          : "original.mp4";
    }

    if (!buffer || !buffer.length) {
      throw createHttpError(400, "Invalid video payload");
    }
    if (buffer.length > REEL_UPLOAD_LIMIT_BYTES) {
      throw createHttpError(413, "Video too large. Max allowed is 40MB");
    }

    if (!isCloudinaryConfigured()) {
      throw createHttpError(
        500,
        "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.",
      );
    }

    console.log("[reels] uploading video", {
      reelId: reel._id.toString(),
      userId: req.user._id.toString(),
      mimeType,
      fileName,
      sizeBytes: buffer.length,
      via: hasMultipartVideo ? "multipart" : "base64",
      target: "cloudinary",
    });

    const uploaded = await uploadVideoBufferToCloudinary({
      buffer,
      mimeType,
      fileName,
      userId: req.user._id.toString(),
      reelId: reel._id.toString(),
    });

    const publicId =
      typeof uploaded.public_id === "string" ? uploaded.public_id.trim() : "";
    const videoUrl =
      typeof uploaded.secure_url === "string" && uploaded.secure_url.trim()
        ? uploaded.secure_url.trim()
        : "";
    const generatedThumbUrl =
      (Array.isArray(uploaded.eager) && uploaded.eager[0]?.secure_url) || "";

    if (!publicId || !videoUrl) {
      throw createHttpError(
        500,
        "Cloudinary upload failed to return required media metadata.",
      );
    }
    const storageKey = buildStorageKeyFromPublicId(publicId);

    reel.cloudinaryPublicId = publicId;
    reel.storageKey = storageKey;
    reel.originalUrl = videoUrl;
    reel.playbackUrl = videoUrl;
    if (generatedThumbUrl) {
      reel.thumbUrl = generatedThumbUrl;
    }
    await reel.save();

    console.log("[reels] video upload success", {
      reelId: reel._id.toString(),
      userId: req.user._id.toString(),
      storageKey,
      videoUrl,
      thumbUrl: generatedThumbUrl || "(none)",
      target: "cloudinary",
    });

    return res.status(200).json({
      storageKey,
      videoUrl,
      reel: mapReel(reel, req.user._id.toString()),
    });
  } catch (error) {
    console.error("[reels] video upload failed:", error);
    if (
      error?.details?.code === "CLOUDINARY_UPLOAD_TIMEOUT" ||
      error?.details?.code === "CLOUDINARY_UPLOAD_FAILED"
    ) {
      return res.status(error.statusCode || 502).json({
        message: error.message,
        code: error.details.code,
        details: {
          attempts: error.details.attempts,
          retryable: error.details.retryable,
        },
      });
    }
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
      reel: mapReel(reel, req.user._id.toString()),
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
      reel: mapReel(reel, req.user._id.toString()),
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

    await deleteCloudinaryVideo(getCloudinaryPublicIdFromReel(reel));
    await Promise.all([
      ReelReport.deleteMany({ reel: reelId }),
      Reel.deleteOne({ _id: reelId }),
    ]);
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

    let alreadyReported = false;
    try {
      await ReelReport.create({
        reel: reel._id,
        reporter: req.user._id,
        owner: reel.author,
        reason,
        description,
        status: "open",
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      alreadyReported = true;
    }

    return res
      .status(alreadyReported ? 200 : 201)
      .json({ message: alreadyReported ? "Reel already reported" : "Reel reported" });
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
  signUpload,
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
