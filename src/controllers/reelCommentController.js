const mongoose = require("mongoose");
const ReelComment = require("../models/ReelComment");
const Reel = require("../models/Reel");
const User = require("../models/User");
const { createHttpError } = require("../utils/httpError");
const {
  buildVisibleAppUserQuery,
  filterVisibleMentions,
  isVisibleUserId,
} = require("../utils/contentVisibility");
const {
  createNotification,
  deleteNotifications,
} = require("../utils/notifications");
const {
  mapCommentMentions,
  normalizeCommentMentions,
} = require("../utils/commentMentions");

const toIdString = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value._id) return value._id.toString();
  return value.toString();
};

const mapComment = (comment, currentUserId) => {
  const authorId = toIdString(comment.author);
  return {
    id: comment._id.toString(),
    reelId: comment.reel.toString(),
    author: {
      id: authorId,
      name: comment.author?.name || "Unknown",
      avatarUrl: comment.author?.avatarUrl || "",
    },
    text: comment.text,
    mentions: mapCommentMentions(comment.mentions || []),
    parentCommentId: comment.parentComment
      ? comment.parentComment.toString()
      : null,
    likesCount: comment.likes?.length || 0,
    dislikesCount: comment.dislikes?.length || 0,
    likedByMe: Array.isArray(comment.likes)
      ? comment.likes.some((id) => toIdString(id) === currentUserId)
      : false,
    dislikedByMe: Array.isArray(comment.dislikes)
      ? comment.dislikes.some((id) => toIdString(id) === currentUserId)
      : false,
    isAuthor:
      authorId === currentUserId ||
      false,
    createdAt: comment.createdAt,
  };
};

// GET /api/reels/:reelId/comments
const getComments = async (req, res, next) => {
  try {
    const { reelId } = req.params;
    const currentUserId = req.user._id.toString();

    if (!mongoose.Types.ObjectId.isValid(reelId)) {
      throw createHttpError(400, "Invalid reel id");
    }

    const reel = await Reel.findById(reelId);
    if (!reel) {
      throw createHttpError(404, "Reel not found");
    }

    if (!(await isVisibleUserId(User, reel.author))) {
      throw createHttpError(404, "Reel not found");
    }

    const comments = await ReelComment.find({ reel: reelId })
      .sort({ createdAt: 1 })
      .populate("author", "name avatarUrl role accountStatus")
      .populate("mentions.user", "name avatarUrl role accountStatus")
      .lean();

    const visibleAuthorIds = new Set(
      (
        await User.distinct("_id", {
          _id: { $in: comments.map((comment) => comment.author).filter(Boolean) },
          ...buildVisibleAppUserQuery(),
        })
      ).map((id) => id.toString()),
    );

    const visibleComments = comments
      .filter((comment) => visibleAuthorIds.has(toIdString(comment.author)))
      .map((comment) => ({
        ...comment,
        mentions: filterVisibleMentions(comment.mentions || []),
      }));

    const mapped = visibleComments.map((c) => mapComment(c, currentUserId));

    // Build nested tree
    const commentMap = {};
    const roots = [];

    for (const c of mapped) {
      c.replies = [];
      commentMap[c.id] = c;
    }

    for (const c of mapped) {
      if (c.parentCommentId && commentMap[c.parentCommentId]) {
        commentMap[c.parentCommentId].replies.push(c);
      } else {
        roots.push(c);
      }
    }

    // Count total (all comments + replies count as comments)
    const totalCount = mapped.length;

    return res.status(200).json({
      comments: roots,
      totalCount,
    });
  } catch (error) {
    return next(error);
  }
};

// POST /api/reels/:reelId/comments
const addComment = async (req, res, next) => {
  try {
    const { reelId } = req.params;
    const currentUserId = req.user._id.toString();

    if (!mongoose.Types.ObjectId.isValid(reelId)) {
      throw createHttpError(400, "Invalid reel id");
    }

    const reel = await Reel.findById(reelId);
    if (!reel) {
      throw createHttpError(404, "Reel not found");
    }

    if (!(await isVisibleUserId(User, reel.author))) {
      throw createHttpError(404, "Reel not found");
    }

    const text =
      typeof req.body.text === "string" ? req.body.text.trim() : "";
    if (!text || text.length > 500) {
      throw createHttpError(
        400,
        "Comment text is required (max 500 characters)",
      );
    }

    const mentions = await normalizeCommentMentions(req.body?.mentions, text);

    const parentCommentId = req.body.parentCommentId || null;
    let parent = null;
    if (parentCommentId) {
      if (!mongoose.Types.ObjectId.isValid(parentCommentId)) {
        throw createHttpError(400, "Invalid parent comment id");
      }
      parent = await ReelComment.findById(parentCommentId);
      if (!parent || parent.reel.toString() !== reelId) {
        throw createHttpError(404, "Parent comment not found");
      }
      if (!(await isVisibleUserId(User, parent.author))) {
        throw createHttpError(404, "Parent comment not found");
      }
    }

    const comment = await ReelComment.create({
      reel: reelId,
      author: currentUserId,
      text,
      mentions,
      parentComment: parentCommentId,
    });

    // Update reel commentsCount
    const totalCount = await ReelComment.countDocuments({ reel: reelId });
    reel.commentsCount = totalCount;
    await reel.save();

    await comment.populate("author", "name avatarUrl role accountStatus");
    await comment.populate("mentions.user", "name avatarUrl role accountStatus");
    comment.mentions = filterVisibleMentions(comment.mentions || []);

    const mapped = mapComment(comment, currentUserId);
    mapped.replies = [];

    if (parent) {
      await createNotification({
        recipientId: parent.author,
        actor: req.user,
        type: "reply_reel_comment",
        reelId: reel._id,
        referenceId: comment._id.toString(),
        message: "replied to your reel comment.",
        deepLink: `/reels/${reel._id.toString()}`,
        push: {
          eventType: "reply_reel_comment",
          title: `${req.user.name} replied to your reel comment`,
          body: text,
        },
      });
    }

    return res.status(201).json({
      comment: mapped,
      commentsCount: totalCount,
    });
  } catch (error) {
    return next(error);
  }
};

// POST /api/reels/:reelId/comments/:commentId/like
const likeComment = async (req, res, next) => {
  try {
    const { commentId } = req.params;
    const userId = req.user._id.toString();

    const comment = await ReelComment.findById(commentId);
    if (!comment) {
      throw createHttpError(404, "Comment not found");
    }

    if (!(await isVisibleUserId(User, comment.author))) {
      throw createHttpError(404, "Comment not found");
    }

    const reel = await Reel.findById(comment.reel).select("author");
    if (!reel || !(await isVisibleUserId(User, reel.author))) {
      throw createHttpError(404, "Comment not found");
    }

    const likeIndex = comment.likes.findIndex(
      (id) => id.toString() === userId,
    );
    const liked = likeIndex === -1;

    if (liked) {
      comment.likes.push(new mongoose.Types.ObjectId(userId));
      // Remove dislike if exists
      const dislikeIndex = comment.dislikes.findIndex(
        (id) => id.toString() === userId,
      );
      if (dislikeIndex !== -1) {
        comment.dislikes.splice(dislikeIndex, 1);
      }
    } else {
      comment.likes.splice(likeIndex, 1);
    }

    await comment.save();

    return res.status(200).json({
      liked,
      likesCount: comment.likes.length,
      dislikesCount: comment.dislikes.length,
    });
  } catch (error) {
    return next(error);
  }
};

// POST /api/reels/:reelId/comments/:commentId/dislike
const dislikeComment = async (req, res, next) => {
  try {
    const { commentId } = req.params;
    const userId = req.user._id.toString();

    const comment = await ReelComment.findById(commentId);
    if (!comment) {
      throw createHttpError(404, "Comment not found");
    }

    if (!(await isVisibleUserId(User, comment.author))) {
      throw createHttpError(404, "Comment not found");
    }

    const reel = await Reel.findById(comment.reel).select("author");
    if (!reel || !(await isVisibleUserId(User, reel.author))) {
      throw createHttpError(404, "Comment not found");
    }

    const dislikeIndex = comment.dislikes.findIndex(
      (id) => id.toString() === userId,
    );
    const disliked = dislikeIndex === -1;

    if (disliked) {
      comment.dislikes.push(new mongoose.Types.ObjectId(userId));
      // Remove like if exists
      const likeIndex = comment.likes.findIndex(
        (id) => id.toString() === userId,
      );
      if (likeIndex !== -1) {
        comment.likes.splice(likeIndex, 1);
      }
    } else {
      comment.dislikes.splice(dislikeIndex, 1);
    }

    await comment.save();

    return res.status(200).json({
      disliked,
      likesCount: comment.likes.length,
      dislikesCount: comment.dislikes.length,
    });
  } catch (error) {
    return next(error);
  }
};

// DELETE /api/reels/:reelId/comments/:commentId
const deleteComment = async (req, res, next) => {
  try {
    const { reelId, commentId } = req.params;
    const userId = req.user._id.toString();

    const comment = await ReelComment.findById(commentId);
    if (!comment) {
      throw createHttpError(404, "Comment not found");
    }
    if (!(await isVisibleUserId(User, comment.author))) {
      throw createHttpError(404, "Comment not found");
    }
    if (comment.author.toString() !== userId) {
      throw createHttpError(403, "You can only delete your own comments");
    }

    // Delete comment and all its descendants
    const deletedIds = new Set([comment._id.toString()]);

    const deleteDescendants = async (parentId) => {
      const children = await ReelComment.find({ parentComment: parentId });
      for (const child of children) {
        deletedIds.add(child._id.toString());
        await deleteDescendants(child._id);
        await ReelComment.deleteOne({ _id: child._id });
      }
    };

    await deleteDescendants(comment._id);
    await ReelComment.deleteOne({ _id: commentId });

    // Update reel commentsCount
    const totalCount = await ReelComment.countDocuments({ reel: reelId });
    await Reel.findByIdAndUpdate(reelId, { commentsCount: totalCount });
    await deleteNotifications({
      reel: reelId,
      referenceId: { $in: [...deletedIds] },
      type: "reply_reel_comment",
    });

    return res.status(200).json({
      message: "Comment deleted",
      commentsCount: totalCount,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getComments,
  addComment,
  likeComment,
  dislikeComment,
  deleteComment,
};
