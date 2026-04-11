const Message = require("../models/Message");
const Post = require("../models/Post");
const Report = require("../models/Report");
const Reel = require("../models/Reel");
const ReelComment = require("../models/ReelComment");
const Story = require("../models/Story");
const User = require("../models/User");
const cloudinary = require("../config/cloudinary");
const { env } = require("../config/env");
const { createHttpError } = require("../utils/httpError");
const { createUserNotification } = require("../utils/notificationCenter");
const { normalizeImageUrls, serializePost } = require("../utils/serializePost");
const {
  applyBanToUser,
  BAN_DURATION_OPTIONS,
  buildBanSnapshot,
  clearUserBan,
} = require("../utils/userAccess");

const REEL_UPLOAD_LIMIT_BYTES = 40 * 1024 * 1024;
const ALLOWED_REEL_VISIBILITY = [
  "public",
  "friends",
  "followers",
  "private",
];

const serializeAdminUser = (user, postCount = 0) => ({
  id: user._id.toString(),
  name: user.name,
  email: user.email,
  username: user.username || "",
  role: user.role || "user",
  avatarUrl: user.avatarUrl || "",
  bio: user.bio || "",
  createdAt: user.createdAt,
  followersCount: Array.isArray(user.followers) ? user.followers.length : 0,
  followingCount: Array.isArray(user.following) ? user.following.length : 0,
  postCount,
  ban: buildBanSnapshot(user),
  canManage: user.role !== "admin",
});

const serializeAdminPost = (post) => {
  const serialized = serializePost(post);

  return {
    ...serialized,
    status: "published",
    caption: serialized.text,
    likeCount: Array.isArray(serialized.likes) ? serialized.likes.length : 0,
    commentCount: Array.isArray(serialized.comments)
      ? serialized.comments.length
      : 0,
  };
};

const serializeAdminReport = (report) => ({
  id: report._id.toString(),
  reason: report.reason,
  description: report.description || "",
  status: report.status || "open",
  createdAt: report.createdAt,
  reporter: report.reporter
    ? {
        id: report.reporter._id.toString(),
        name: report.reporter.name || "Unknown",
        email: report.reporter.email || "",
      }
    : null,
  post: report.post
    ? {
        id: report.post._id.toString(),
        text: report.post.text || "",
        imageUrl:
          (Array.isArray(report.post.imageUrls) && report.post.imageUrls[0]) ||
          report.post.imageUrl ||
          "",
        author: report.post.author
          ? {
              id: report.post.author._id.toString(),
              name: report.post.author.name || "Unknown",
            }
          : null,
      }
    : null,
});

const toIdString = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value._id) return value._id.toString();
  return value.toString();
};

const arrayHasUser = (values, userId) =>
  Array.isArray(values) && values.some((value) => toIdString(value) === userId);

const isCloudinaryConfigured = () =>
  Boolean(
    env.CLOUDINARY_CLOUD_NAME &&
      env.CLOUDINARY_API_KEY &&
      env.CLOUDINARY_API_SECRET,
  );

const buildCloudinaryPublicId = ({ userId, reelId }) =>
  `${userId}/${reelId}/original`;

const buildStorageKeyFromPublicId = (publicId) => `cloudinary:${publicId}`;

const uploadVideoBufferToCloudinary = async ({
  buffer,
  mimeType,
  userId,
  reelId,
}) => {
  if (!isCloudinaryConfigured()) {
    throw createHttpError(
      500,
      "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.",
    );
  }

  const formatFromMime =
    typeof mimeType === "string" && mimeType.includes("/")
      ? mimeType.split("/")[1].toLowerCase()
      : "";

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "video",
        folder: "reels",
        public_id: buildCloudinaryPublicId({ userId, reelId }),
        overwrite: true,
        quality: "auto",
        fetch_format: "auto",
        timeout: env.REELS_UPLOAD_TIMEOUT_MS,
        ...(formatFromMime ? { format: formatFromMime } : {}),
        eager: [
          {
            format: "jpg",
            width: 720,
            crop: "limit",
            start_offset: "1",
          },
        ],
      },
      (error, result) => {
        if (error) {
          return reject(
            createHttpError(
              502,
              `Cloudinary upload failed: ${error.message || "unknown error"}`,
            ),
          );
        }
        if (!result) {
          return reject(
            createHttpError(502, "Cloudinary upload failed: empty response."),
          );
        }
        return resolve(result);
      },
    );

    uploadStream.end(buffer);
  });
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
    console.warn("[admin][reels] failed to delete Cloudinary asset", {
      publicId,
      error: error?.message || String(error),
    });
  }
};

const serializeAdminReel = (reel, currentUserId = "") => {
  const authorId = toIdString(reel.author);
  const storageKey = reel.storageKey || "";

  return {
    id: reel._id.toString(),
    author: {
      id: authorId,
      name: reel.author?.name || "Unknown",
      avatarUrl: reel.author?.avatarUrl || "",
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
    visibility: reel.visibility,
    status: reel.status,
    failureReason: reel.failureReason || "",
    likesCount: Number.isFinite(reel.likesCount)
      ? reel.likesCount
      : reel.likes?.length || 0,
    commentsCount: Number.isFinite(reel.commentsCount)
      ? reel.commentsCount
      : 0,
    viewsCount: Number.isFinite(reel.viewsCount)
      ? reel.viewsCount
      : reel.viewers?.length || 0,
    repostsCount: reel.repostsCount || 0,
    sharesCount: reel.sharesCount || 0,
    savesCount: Number.isFinite(reel.savesCount)
      ? reel.savesCount
      : reel.saves?.length || 0,
    likedByMe: arrayHasUser(reel.likes, currentUserId),
    savedByMe: arrayHasUser(reel.saves, currentUserId),
    ownedByMe: authorId === currentUserId,
    createdAt: reel.createdAt,
    updatedAt: reel.updatedAt,
    processedAt: reel.processedAt || null,
  };
};

const getPostCountMap = async () => {
  const groupedPosts = await Post.aggregate([
    {
      $group: {
        _id: "$author",
        count: { $sum: 1 },
      },
    },
  ]);

  return new Map(groupedPosts.map((item) => [item._id.toString(), item.count]));
};

const getSummary = async (_req, res, next) => {
  try {
    const [
      totalUsers,
      totalPosts,
      totalReels,
      bannedUsers,
      recentUsers,
      recentPosts,
      recentReels,
    ] =
      await Promise.all([
        User.countDocuments(),
        Post.countDocuments(),
        Reel.countDocuments(),
        User.countDocuments({
          $or: [
            { banIsPermanent: true },
            { banExpiresAt: { $gt: new Date() } },
          ],
        }),
        User.find()
          .sort({ createdAt: -1 })
          .limit(3)
          .select("name role createdAt"),
        Post.find()
          .sort({ createdAt: -1 })
          .limit(3)
          .populate("author", "name")
          .select("text createdAt author"),
        Reel.find()
          .sort({ createdAt: -1 })
          .limit(3)
          .populate("author", "name")
          .select("caption createdAt author"),
      ]);

    const recentActivity = [
      ...recentUsers.map((user) => ({
        id: `user-${user._id.toString()}`,
        type: "user",
        title: user.name,
        subtitle: `Joined as ${user.role}`,
        createdAt: user.createdAt,
      })),
      ...recentPosts.map((post) => ({
        id: `post-${post._id.toString()}`,
        type: "post",
        title:
          typeof post.text === "string" && post.text.trim()
            ? post.text.trim().slice(0, 80)
            : "Image post",
        subtitle: `Created by ${post.author?.name || "Unknown"}`,
        createdAt: post.createdAt,
      })),
      ...recentReels.map((reel) => ({
        id: `reel-${reel._id.toString()}`,
        type: "reel",
        title:
          typeof reel.caption === "string" && reel.caption.trim()
            ? reel.caption.trim().slice(0, 80)
            : "Video reel",
        subtitle: `Reel by ${reel.author?.name || "Unknown"}`,
        createdAt: reel.createdAt,
      })),
    ].sort(
      (left, right) =>
        new Date(right.createdAt).getTime() -
        new Date(left.createdAt).getTime(),
    );

    return res.status(200).json({
      summary: {
        totalUsers,
        totalPosts,
        totalReels,
        bannedUsers,
        recentActivity,
      },
    });
  } catch (error) {
    return next(error);
  }
};

const listUsers = async (_req, res, next) => {
  try {
    const [users, postCountMap] = await Promise.all([
      User.find().sort({ createdAt: -1 }),
      getPostCountMap(),
    ]);

    return res.status(200).json({
      users: users.map((user) =>
        serializeAdminUser(user, postCountMap.get(user._id.toString()) || 0),
      ),
    });
  } catch (error) {
    return next(error);
  }
};

const sendAdminNotification = async (req, res, next) => {
  try {
    const title = typeof req.body.title === "string" ? req.body.title.trim() : "";
    const body = typeof req.body.body === "string" ? req.body.body.trim() : "";
    const allUsers = Boolean(req.body.allUsers);
    const rawUserIds = Array.isArray(req.body.userIds)
      ? req.body.userIds.filter((value) => typeof value === "string")
      : [];
    const uniqueUserIds = Array.from(new Set(rawUserIds));

    if (!title || !body) {
      throw createHttpError(400, "Notification title and body are required");
    }

    if (!allUsers && uniqueUserIds.length === 0) {
      throw createHttpError(400, "Select at least one user");
    }

    const query = allUsers
      ? {}
      : {
          _id: {
            $in: uniqueUserIds,
          },
        };

    const users = await User.find(query).select("_id expoPushTokens").lean();

    if (!users.length) {
      throw createHttpError(404, "No users found for this notification");
    }

    await Promise.all(
      users.map((user) =>
        createUserNotification({
          userId: user._id,
          type: "admin_broadcast",
          title,
          body,
          data: {
            type: "admin_broadcast",
            senderId: req.user._id.toString(),
          },
          push: {
            enabled: true,
            tokens: user.expoPushTokens || [],
            channelId: "messages",
          },
        }),
      ),
    );

    return res.status(200).json({
      message: "Notification sent successfully",
      sentCount: users.length,
    });
  } catch (error) {
    return next(error);
  }
};

const getUserDetails = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      throw createHttpError(404, "User not found");
    }

    const [postCount, recentPosts] = await Promise.all([
      Post.countDocuments({ author: user._id }),
      Post.find({ author: user._id })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate("author", "name avatarUrl")
        .populate("comments.author", "name avatarUrl")
        .lean(),
    ]);

    return res.status(200).json({
      user: serializeAdminUser(user, postCount),
      recentPosts: recentPosts.map(serializeAdminPost),
    });
  } catch (error) {
    return next(error);
  }
};

const banUser = async (req, res, next) => {
  try {
    const { duration } = req.body;
    const user = await User.findById(req.params.userId);

    if (!BAN_DURATION_OPTIONS.includes(duration)) {
      throw createHttpError(400, "Invalid ban duration");
    }

    if (!user) {
      throw createHttpError(404, "User not found");
    }

    if (user.role === "admin") {
      throw createHttpError(403, "Admin accounts cannot be banned");
    }

    await applyBanToUser(user, duration);

    return res.status(200).json({
      message: "User banned successfully",
      user: serializeAdminUser(
        user,
        await Post.countDocuments({ author: user._id }),
      ),
    });
  } catch (error) {
    return next(error);
  }
};

const unbanUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      throw createHttpError(404, "User not found");
    }

    if (user.role === "admin") {
      throw createHttpError(403, "Admin accounts cannot be unbanned here");
    }

    await clearUserBan(user);

    return res.status(200).json({
      message: "User unbanned successfully",
      user: serializeAdminUser(
        user,
        await Post.countDocuments({ author: user._id }),
      ),
    });
  } catch (error) {
    return next(error);
  }
};

const deleteUser = async (req, res, next) => {
  try {
    const { userId } = req.params;

    if (req.user._id.toString() === userId) {
      throw createHttpError(400, "You cannot delete your own admin account");
    }

    const user = await User.findById(userId);
    if (!user) {
      throw createHttpError(404, "User not found");
    }

    if (user.role === "admin") {
      throw createHttpError(403, "Admin accounts cannot be deleted here");
    }

    await Promise.all([
      Post.deleteMany({ author: user._id }),
      Story.deleteMany({ author: user._id }),
      Reel.deleteMany({ author: user._id }),
      ReelComment.deleteMany({ author: user._id }),
      Message.deleteMany({
        $or: [{ sender: user._id }, { receiver: user._id }],
      }),
      User.updateMany(
        {},
        {
          $pull: {
            followers: user._id,
            following: user._id,
          },
        },
      ),
      Post.updateMany(
        {},
        {
          $pull: {
            likes: user._id,
            comments: { author: user._id },
          },
        },
      ),
      Reel.updateMany(
        {},
        {
          $pull: {
            likes: user._id,
            saves: user._id,
            viewers: user._id,
          },
        },
      ),
      User.deleteOne({ _id: user._id }),
    ]);

    return res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
    return next(error);
  }
};

const listPosts = async (_req, res, next) => {
  try {
    const posts = await Post.find()
      .sort({ createdAt: -1 })
      .populate("author", "name avatarUrl")
      .populate("comments.author", "name avatarUrl")
      .lean();

    return res.status(200).json({
      posts: posts.map(serializeAdminPost),
    });
  } catch (error) {
    return next(error);
  }
};

const listReports = async (_req, res, next) => {
  try {
    const reports = await Report.find()
      .sort({ createdAt: -1 })
      .limit(400)
      .populate("reporter", "name email")
      .populate({
        path: "post",
        select: "text imageUrl imageUrls author",
        populate: {
          path: "author",
          select: "name",
        },
      })
      .lean();

    return res.status(200).json({
      reports: reports.map(serializeAdminReport),
    });
  } catch (error) {
    return next(error);
  }
};

const getPostDetails = async (req, res, next) => {
  try {
    const post = await Post.findById(req.params.postId)
      .populate("author", "name avatarUrl")
      .populate("comments.author", "name avatarUrl")
      .lean();

    if (!post) {
      throw createHttpError(404, "Post not found");
    }

    return res.status(200).json({
      post: serializeAdminPost(post),
    });
  } catch (error) {
    return next(error);
  }
};

const createAdminPost = async (req, res, next) => {
  try {
    const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
    const imageUrls = normalizeImageUrls(req.body);

    if (imageUrls.length === 0) {
      throw createHttpError(400, "Post must include at least one image");
    }

    const post = await Post.create({
      author: req.user._id,
      text,
      imageUrl: imageUrls[0] || "",
      imageUrls,
      likes: [],
      comments: [],
    });

    const createdPost = await Post.findById(post._id)
      .populate("author", "name avatarUrl")
      .populate("comments.author", "name avatarUrl")
      .lean();

    return res.status(201).json({
      post: serializeAdminPost(createdPost),
    });
  } catch (error) {
    return next(error);
  }
};

const deleteAdminPost = async (req, res, next) => {
  try {
    const post = await Post.findById(req.params.postId);
    if (!post) {
      throw createHttpError(404, "Post not found");
    }

    await Post.deleteOne({ _id: post._id });
    return res.status(200).json({ message: "Post deleted successfully" });
  } catch (error) {
    return next(error);
  }
};

const listReels = async (req, res, next) => {
  try {
    const reels = await Reel.find()
      .sort({ createdAt: -1 })
      .populate("author", "name avatarUrl")
      .lean();

    return res.status(200).json({
      reels: reels.map((reel) =>
        serializeAdminReel(reel, req.user._id.toString()),
      ),
    });
  } catch (error) {
    return next(error);
  }
};

const getReelDetails = async (req, res, next) => {
  try {
    const reel = await Reel.findById(req.params.reelId)
      .populate("author", "name avatarUrl")
      .lean();

    if (!reel) {
      throw createHttpError(404, "Reel not found");
    }

    return res.status(200).json({
      reel: serializeAdminReel(reel, req.user._id.toString()),
    });
  } catch (error) {
    return next(error);
  }
};

const createAdminReel = async (req, res, next) => {
  try {
    const caption =
      typeof req.body.caption === "string" ? req.body.caption.trim() : "";
    const music = typeof req.body.music === "string" ? req.body.music.trim() : "";
    const visibility =
      typeof req.body.visibility === "string" &&
      ALLOWED_REEL_VISIBILITY.includes(req.body.visibility)
        ? req.body.visibility
        : "public";
    const thumbUrl =
      typeof req.body.thumbUrl === "string" ? req.body.thumbUrl.trim() : "";
    const mimeType =
      typeof req.body.mimeType === "string" && req.body.mimeType.trim()
        ? req.body.mimeType.trim()
        : "video/mp4";
    const duration = Number.isFinite(req.body.duration)
      ? Number(req.body.duration)
      : 0;
    const width = Number.isFinite(req.body.width) ? Number(req.body.width) : 0;
    const height = Number.isFinite(req.body.height) ? Number(req.body.height) : 0;
    const rawBase64 =
      typeof req.body.base64Data === "string" ? req.body.base64Data : "";

    if (!rawBase64) {
      throw createHttpError(400, "Video data is required");
    }

    const payload = rawBase64.includes(",")
      ? rawBase64.slice(rawBase64.indexOf(",") + 1)
      : rawBase64;
    const buffer = Buffer.from(payload, "base64");

    if (!buffer.length) {
      throw createHttpError(400, "Invalid video data");
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

    const reel = await Reel.create({
      author: req.user._id,
      caption,
      music,
      visibility,
      status: "uploading",
    });

    const uploaded = await uploadVideoBufferToCloudinary({
      buffer,
      mimeType,
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
    reel.thumbUrl = generatedThumbUrl || thumbUrl;
    reel.duration = duration;
    reel.width = width;
    reel.height = height;
    reel.status = "ready";
    reel.failureReason = "";
    reel.processedAt = new Date();
    await reel.save();

    const createdReel = await Reel.findById(reel._id)
      .populate("author", "name avatarUrl")
      .lean();

    return res.status(201).json({
      reel: serializeAdminReel(createdReel, req.user._id.toString()),
    });
  } catch (error) {
    return next(error);
  }
};

const deleteAdminReel = async (req, res, next) => {
  try {
    const reel = await Reel.findById(req.params.reelId);
    if (!reel) {
      throw createHttpError(404, "Reel not found");
    }

    await deleteCloudinaryVideo(getCloudinaryPublicIdFromReel(reel));

    await Promise.all([
      ReelComment.deleteMany({ reel: reel._id }),
      Reel.deleteOne({ _id: reel._id }),
    ]);

    return res.status(200).json({ message: "Reel deleted successfully" });
  } catch (error) {
    return next(error);
  }
};

const blockPostEdit = async (_req, res) => {
  return res.status(403).json({ message: "Editing posts is not allowed" });
};

const blockReelEdit = async (_req, res) => {
  return res.status(403).json({ message: "Editing reels is not allowed" });
};

module.exports = {
  banUser,
  blockPostEdit,
  blockReelEdit,
  createAdminPost,
  createAdminReel,
  deleteAdminPost,
  deleteAdminReel,
  deleteUser,
  getPostDetails,
  getReelDetails,
  getSummary,
  getUserDetails,
  listPosts,
  listReports,
  listReels,
  listUsers,
  sendAdminNotification,
  unbanUser,
};
