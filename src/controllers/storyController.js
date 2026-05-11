const fs = require("fs/promises");
const path = require("path");
const mongoose = require("mongoose");
const Story = require("../models/Story");
const User = require("../models/User");
const { createHttpError } = require("../utils/httpError");
const {
  buildVisibleAppUserQuery,
  isVisibleUserId,
} = require("../utils/contentVisibility");

const STORY_TTL_HOURS = 24;
const LOCAL_STORY_UPLOAD_LIMIT_BYTES = 20 * 1024 * 1024; // 20MB
const UPLOADS_ROOT = path.join(__dirname, "../../uploads");

const toIdString = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value._id) return value._id.toString();
  return value.toString();
};

const resolveStoryImageUrl = (imageUrl, req) => {
  if (!imageUrl) return "";
  if (!imageUrl.startsWith("/uploads/")) {
    return imageUrl;
  }

  const protocol = req.protocol || "http";
  const host = req.get("host");
  return `${protocol}://${host}${imageUrl}`;
};

const getFileExtensionForMimeType = (mimeType) => {
  const normalized = String(mimeType || "image/jpeg").toLowerCase();

  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/svg+xml") return "svg";

  const extension = normalized.split("/")[1] || "jpg";
  return extension.replace(/[^a-z0-9]/g, "") || "jpg";
};

const parseImageDataUri = (value) => {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(value || "");
  if (!match) return null;

  return {
    mimeType: match[1].toLowerCase(),
    payload: match[2],
  };
};

const clamp = (value, min, max) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(Math.max(numeric, min), max);
};

const normalizeImageFit = (value) =>
  value === "contain" ? "contain" : "cover";

const normalizeTextOverlay = (value) => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const text = typeof value.text === "string" ? value.text.trim() : "";
  if (!text) {
    return null;
  }

  return {
    text: text.slice(0, 200),
    x: clamp(value.x, 0.08, 0.92),
    y: clamp(value.y, 0.12, 0.88),
    scale: clamp(value.scale, 0.05, 0.18),
  };
};

const persistStoryImage = async ({ imageUrl, storyId, userId }) => {
  const normalizedImageUrl =
    typeof imageUrl === "string" ? imageUrl.trim() : "";

  if (!normalizedImageUrl) {
    throw createHttpError(400, "imageUrl is required");
  }

  const dataUri = parseImageDataUri(normalizedImageUrl);
  if (!dataUri) {
    return normalizedImageUrl;
  }

  const buffer = Buffer.from(dataUri.payload, "base64");
  if (!buffer.length) {
    throw createHttpError(400, "Invalid story image");
  }

  if (buffer.length > LOCAL_STORY_UPLOAD_LIMIT_BYTES) {
    throw createHttpError(413, "Story image too large. Max allowed is 20MB");
  }

  const extension = getFileExtensionForMimeType(dataUri.mimeType);
  const storageKey = path.posix.join(
    "stories",
    userId,
    storyId,
    `story.${extension}`,
  );
  const absolutePath = path.join(UPLOADS_ROOT, storageKey);

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, buffer);

  return `/uploads/${storageKey}`;
};

const removeStoredStoryImage = async (imageUrl) => {
  if (
    typeof imageUrl !== "string" ||
    !imageUrl.startsWith("/uploads/stories/")
  ) {
    return;
  }

  const relativePath = imageUrl.replace(/^\/uploads\//, "");
  const absolutePath = path.join(UPLOADS_ROOT, relativePath);
  await fs.rm(path.dirname(absolutePath), { recursive: true, force: true });
};

const serializeStory = (story, req) => ({
  id: toIdString(story._id || story.id),
  imageUrl: resolveStoryImageUrl(story.imageUrl || "", req),
  caption: story.caption || "",
  imageFit: normalizeImageFit(story.imageFit),
  textOverlay:
    story.textOverlay && story.textOverlay.text
      ? {
          text: story.textOverlay.text,
          x: clamp(story.textOverlay.x, 0.08, 0.92),
          y: clamp(story.textOverlay.y, 0.12, 0.88),
          scale: clamp(story.textOverlay.scale, 0.05, 0.18),
        }
      : null,
  viewers: Array.isArray(story.viewers)
    ? story.viewers.map((viewer) => toIdString(viewer))
    : [],
  createdAt: story.createdAt,
  expiresAt: story.expiresAt,
});

const getVisibleUserIds = async () =>
  User.distinct("_id", buildVisibleAppUserQuery());

// GET /api/stories — fetch all non-expired stories, grouped by author
exports.listStories = async (req, res, next) => {
  try {
    const visibleUserIds = await getVisibleUserIds();
    const stories = await Story.find({
      expiresAt: { $gt: new Date() },
      author: { $in: visibleUserIds },
    })
      .sort({ createdAt: -1 })
      .populate("author", "name avatarUrl")
      .lean();

    const grouped = {};
    for (const story of stories) {
      const authorId = toIdString(story.author);
      if (!authorId) continue;

      if (!grouped[authorId]) {
        grouped[authorId] = {
          user: {
            id: authorId,
            name: story.author?.name || "Unknown",
            avatarUrl: story.author?.avatarUrl || "",
          },
          stories: [],
        };
      }

      grouped[authorId].stories.push(serializeStory(story, req));
    }

    const userId = req.user?._id?.toString();
    const result = Object.values(grouped);
    if (userId) {
      result.sort((a, b) => {
        if (a.user.id === userId) return -1;
        if (b.user.id === userId) return 1;
        return 0;
      });
    }

    res.json({ storyGroups: result });
  } catch (err) {
    next(err);
  }
};

// POST /api/stories — create a story (image required)
exports.createStory = async (req, res, next) => {
  let storedImageUrl = "";

  try {
    const storyId = new mongoose.Types.ObjectId();
    const authorId = req.user._id.toString();
    storedImageUrl = await persistStoryImage({
      imageUrl: req.body?.imageUrl,
      storyId: storyId.toString(),
      userId: authorId,
    });
    const textOverlay = normalizeTextOverlay(req.body?.textOverlay);
    const captionInput =
      typeof req.body?.caption === "string" ? req.body.caption.trim() : "";
    const caption = (captionInput || textOverlay?.text || "").slice(0, 200);
    const imageFit = normalizeImageFit(req.body?.imageFit);

    const story = await Story.create({
      _id: storyId,
      author: req.user._id,
      imageUrl: storedImageUrl,
      caption,
      imageFit,
      textOverlay: textOverlay || undefined,
      expiresAt: new Date(Date.now() + STORY_TTL_HOURS * 60 * 60 * 1000),
    });

    await story.populate("author", "name avatarUrl");

    res.status(201).json({
      story: {
        ...serializeStory(story, req),
        author: {
          id: toIdString(story.author),
          name: story.author?.name || "Unknown",
          avatarUrl: story.author?.avatarUrl || "",
        },
      },
    });
  } catch (err) {
    if (storedImageUrl.startsWith("/uploads/stories/")) {
      try {
        await removeStoredStoryImage(storedImageUrl);
      } catch (cleanupError) {
        console.warn("[STORY] Failed to clean up uploaded image", cleanupError);
      }
    }
    next(err);
  }
};

// POST /api/stories/:storyId/view — mark story as viewed
exports.viewStory = async (req, res, next) => {
  try {
    const story = await Story.findById(req.params.storyId);
    if (!story) return res.status(404).json({ message: "Story not found" });
    if (!(await isVisibleUserId(User, story.author))) {
      return res.status(404).json({ message: "Story not found" });
    }

    const userId = req.user._id;
    if (!story.viewers.some((v) => v.toString() === userId.toString())) {
      story.viewers.push(userId);
      await story.save();
    }

    res.json({ message: "Story viewed" });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/stories/:storyId — delete own story
exports.deleteStory = async (req, res, next) => {
  try {
    const story = await Story.findById(req.params.storyId);
    if (!story) return res.status(404).json({ message: "Story not found" });

    if (story.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not your story" });
    }

    const storedImageUrl = story.imageUrl;
    await story.deleteOne();
    try {
      await removeStoredStoryImage(storedImageUrl);
    } catch (cleanupError) {
      console.warn("[STORY] Failed to remove stored image", cleanupError);
    }

    res.json({ message: "Story deleted" });
  } catch (err) {
    next(err);
  }
};
