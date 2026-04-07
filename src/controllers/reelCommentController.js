const mongoose = require("mongoose");
const ReelComment = require("../models/ReelComment");
const Reel = require("../models/Reel");
const User = require("../models/User");
const { createHttpError } = require("../utils/httpError");
const { createUserNotification } = require("../utils/notificationCenter");

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

    const comments = await ReelComment.find({ reel: reelId })
      .sort({ createdAt: 1 })
      .populate("author", "name avatarUrl")
      .lean();

    const mapped = comments.map((c) => mapComment(c, currentUserId));

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

    const text =
      typeof req.body.text === "string" ? req.body.text.trim() : "";
    if (!text || text.length > 500) {
      throw createHttpError(
        400,
        "Comment text is required (max 500 characters)",
      );
    }

    const parentCommentId = req.body.parentCommentId || null;
    if (parentCommentId) {
      if (!mongoose.Types.ObjectId.isValid(parentCommentId)) {
        throw createHttpError(400, "Invalid parent comment id");
      }
      const parent = await ReelComment.findById(parentCommentId);
      if (!parent || parent.reel.toString() !== reelId) {
        throw createHttpError(404, "Parent comment not found");
      }
    }

    const comment = await ReelComment.create({
      reel: reelId,
      author: currentUserId,
      text,
      parentComment: parentCommentId,
    });

    // Update reel commentsCount
    const totalCount = await ReelComment.countDocuments({ reel: reelId });
    reel.commentsCount = totalCount;
    await reel.save();

    const reelAuthorId = reel.author.toString();
    if (reelAuthorId !== currentUserId) {
      try {
        const reelAuthor = await User.findById(reelAuthorId).select(
          "expoPushTokens",
        );
        await createUserNotification({
          userId: reelAuthorId,
          type: "reel_comment",
          title: `${req.user?.name || "Someone"} commented on your reel`,
          body: text.slice(0, 160) || "Someone commented on your reel.",
          data: {
            type: "reel_comment",
            reelId: reel._id.toString(),
            commentId: comment._id.toString(),
            actorId: currentUserId,
            actorName: req.user?.name || "",
          },
          push: {
            enabled: true,
            tokens: reelAuthor?.expoPushTokens || [],
            channelId: "messages",
          },
        });
      } catch (notificationError) {
        console.warn(
          "[reel_comment] notification dispatch failed:",
          notificationError,
        );
      }
    }

    await comment.populate("author", "name avatarUrl");

    const mapped = mapComment(comment, currentUserId);
    mapped.replies = [];

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
    if (comment.author.toString() !== userId) {
      throw createHttpError(403, "You can only delete your own comments");
    }

    // Delete comment and all its descendants
    const deleteDescendants = async (parentId) => {
      const children = await ReelComment.find({ parentComment: parentId });
      for (const child of children) {
        await deleteDescendants(child._id);
        await ReelComment.deleteOne({ _id: child._id });
      }
    };

    await deleteDescendants(comment._id);
    await ReelComment.deleteOne({ _id: commentId });

    // Update reel commentsCount
    const totalCount = await ReelComment.countDocuments({ reel: reelId });
    await Reel.findByIdAndUpdate(reelId, { commentsCount: totalCount });

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
