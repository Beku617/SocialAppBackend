const mongoose = require("mongoose");
const Post = require("../models/Post");
const User = require("../models/User");
const { createHttpError } = require("../utils/httpError");
const bcrypt = require("bcryptjs");
const {
  deleteNotifications,
  replaceNotification,
  createNotification,
} = require("../utils/notifications");
const {
  mapCommentMentions,
  normalizeCommentMentions,
} = require("../utils/commentMentions");
const {
  buildVisibleAppUserQuery,
  filterVisibleEmbeddedComments,
  filterVisibleMentions,
  isVisibleUserId,
} = require("../utils/contentVisibility");

const mapComment = (comment) => ({
  id: comment._id.toString(),
  author: comment.author
    ? {
        id: comment.author._id.toString(),
        name: comment.author.name,
        avatarUrl: comment.author.avatarUrl || "",
      }
    : {
        id: "",
        name: "Unknown",
        avatarUrl: "",
      },
  text: comment.text,
  mentions: mapCommentMentions(comment.mentions || []),
  parentCommentId: comment.parentComment
    ? comment.parentComment.toString()
    : null,
  createdAt: comment.createdAt,
});

const getVisibleAuthorIds = async () =>
  User.distinct("_id", buildVisibleAppUserQuery());

const serializeAuthor = (author) => {
  if (!author) return null;
  return {
    id: author._id?.toString?.() || author.id?.toString?.() || "",
    name: author.name || "",
    avatarUrl: author.avatarUrl || "",
  };
};

const serializeMention = (mention) => ({
  userId:
    mention.user?._id?.toString?.() ||
    mention.user?.id?.toString?.() ||
    mention.user?.toString?.() ||
    "",
  name: mention.name || mention.user?.name || "",
  avatarUrl: mention.user?.avatarUrl || "",
  start: mention.start,
  end: mention.end,
});

const serializeComment = (comment) => ({
  id: comment._id?.toString?.() || comment.id?.toString?.() || "",
  author: serializeAuthor(comment.author),
  text: comment.text || "",
  mentions: Array.isArray(comment.mentions)
    ? comment.mentions.map(serializeMention)
    : [],
  parentCommentId: comment.parentComment
    ? comment.parentComment.toString()
    : null,
  createdAt: comment.createdAt,
});

const normalizePostImages = (post) => {
  const imageUrls = Array.isArray(post.imageUrls)
    ? post.imageUrls.filter(
        (url) => typeof url === "string" && url.trim().length > 0,
      )
    : [];
  const rawUrl =
    typeof post.imageUrl === "string" && post.imageUrl.trim().length > 0
      ? post.imageUrl.trim()
      : "";

  // Merge legacy single imageUrl into the array when the array is empty
  const merged = imageUrls.length > 0 ? imageUrls : rawUrl ? [rawUrl] : [];

  return {
    imageUrl: merged[0] || "",
    imageUrls: merged,
  };
};

const serializePost = (post) => {
  const { imageUrl, imageUrls } = normalizePostImages(post);

  return {
    id: post._id?.toString?.() || post.id?.toString?.() || "",
    author: serializeAuthor(post.author),
    text: post.text || "",
    imageUrl,
    imageUrls,
    likes: (post.likes || []).map((l) => l?.toString?.() || l || ""),
    comments: filterVisibleEmbeddedComments(post.comments || []).map(
      serializeComment,
    ),
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
};

const listPosts = async (_req, res, next) => {
  try {
    const visibleAuthorIds = await getVisibleAuthorIds();
    const posts = await Post.find({ author: { $in: visibleAuthorIds } })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("author", "name avatarUrl")
      .populate("comments.author", "name avatarUrl role accountStatus")
      .populate("comments.mentions.user", "name avatarUrl role accountStatus")
      .lean();

    return res.status(200).json({ posts: posts.map(serializePost) });
  } catch (error) {
    return next(error);
  }
};

const getPost = async (req, res, next) => {
  try {
    const visibleAuthorIds = await getVisibleAuthorIds();
    const post = await Post.findOne({
      _id: req.params.postId,
      author: { $in: visibleAuthorIds },
    })
      .populate("author", "name avatarUrl")
      .populate("comments.author", "name avatarUrl role accountStatus")
      .populate("comments.mentions.user", "name avatarUrl role accountStatus")
      .lean();

    if (!post) {
      throw createHttpError(404, "Post not found");
    }

    return res.status(200).json({ post: serializePost(post) });
  } catch (error) {
    return next(error);
  }
};

const getComments = async (req, res, next) => {
  try {
    const { postId } = req.params;
    const visibleAuthorIds = await getVisibleAuthorIds();
    const post = await Post.findOne({
      _id: postId,
      author: { $in: visibleAuthorIds },
    })
      .populate("comments.author", "name avatarUrl role accountStatus")
      .populate("comments.mentions.user", "name avatarUrl role accountStatus")
      .lean({ virtuals: false });

    if (!post) {
      throw createHttpError(404, "Post not found");
    }

    const visibleComments = filterVisibleEmbeddedComments(post.comments || []).map(mapComment);

    return res.status(200).json({
      comments: visibleComments,
      commentsCount: visibleComments.length,
    });
  } catch (error) {
    return next(error);
  }
};

const createPost = async (req, res, next) => {
  try {
    const text = typeof req.body?.text === "string" ? req.body.text : "";

    const rawImageUrls = Array.isArray(req.body?.imageUrls)
      ? req.body.imageUrls
      : [];
    const imageUrls = rawImageUrls
      .map((u) => (typeof u === "string" ? u.trim() : ""))
      .filter((u) => u.length > 0)
      .slice(0, 10);

    const singleImageUrl =
      typeof req.body?.imageUrl === "string" ? req.body.imageUrl.trim() : "";

    if (!imageUrls.length && singleImageUrl) {
      imageUrls.push(singleImageUrl);
    }

    const post = await Post.create({
      author: req.user._id,
      text,
      imageUrl: imageUrls[0] || singleImageUrl || "",
      imageUrls,
      likes: [],
      comments: [],
    });

    await post.populate("author", "name avatarUrl");
    return res.status(201).json({ post });
  } catch (error) {
    return next(error);
  }
};

const toggleLike = async (req, res, next) => {
  try {
    const { postId } = req.params;
    const userId = req.user._id.toString();
    const post = await Post.findById(postId);

    if (!post) {
      throw createHttpError(404, "Post not found");
    }

    if (!(await isVisibleUserId(User, post.author))) {
      throw createHttpError(404, "Post not found");
    }

    const currentIndex = post.likes.findIndex((id) => id.toString() === userId);
    const liked = currentIndex === -1;

    if (liked) {
      post.likes.push(new mongoose.Types.ObjectId(userId));
    } else {
      post.likes.splice(currentIndex, 1);
    }

    await post.save();

    if (liked) {
      await replaceNotification({
        filter: {
          recipient: post.author,
          actor: req.user._id,
          type: "like_post",
          post: post._id,
        },
        recipientId: post.author,
        actor: req.user,
        type: "like_post",
        postId: post._id,
        referenceId: post._id.toString(),
        message: "liked your post.",
        deepLink: `/posts/${post._id.toString()}`,
        push: {
          eventType: "like_post",
          title: `${req.user.name} liked your post`,
          body: "Tap to open the post.",
        },
      });
    } else {
      await deleteNotifications({
        recipient: post.author,
        actor: req.user._id,
        type: "like_post",
        post: post._id,
      });
    }

    return res.status(200).json({
      liked,
      likeCount: post.likes.length,
    });
  } catch (error) {
    return next(error);
  }
};

const addComment = async (req, res, next) => {
  try {
    const { postId } = req.params;
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    const requestedParentCommentId = req.body?.parentCommentId || null;
    const post = await Post.findById(postId);

    if (!post) {
      throw createHttpError(404, "Post not found");
    }

    if (!(await isVisibleUserId(User, post.author))) {
      throw createHttpError(404, "Post not found");
    }

    if (!text || text.length > 500) {
      throw createHttpError(400, "Comment must be 1-500 chars");
    }

    const mentions = await normalizeCommentMentions(req.body?.mentions, text);

    let normalizedParentCommentId = null;
    let parentComment = null;
    if (requestedParentCommentId) {
      parentComment = post.comments.id(requestedParentCommentId);
      if (!parentComment) {
        throw createHttpError(404, "Parent comment not found");
      }

      if (!(await isVisibleUserId(User, parentComment.author))) {
        throw createHttpError(404, "Parent comment not found");
      }

      normalizedParentCommentId = parentComment.parentComment
        ? parentComment.parentComment.toString()
        : parentComment._id.toString();
    }

    post.comments.push({
      author: req.user._id,
      text,
      mentions,
      parentComment: normalizedParentCommentId,
    });
    await post.save();
    await post.populate("comments.author", "name avatarUrl role accountStatus");
    await post.populate("comments.mentions.user", "name avatarUrl role accountStatus");

    const comment = post.comments[post.comments.length - 1];
    comment.mentions = filterVisibleMentions(comment.mentions || []);
    if (normalizedParentCommentId && parentComment) {
      await createNotification({
        recipientId: parentComment.author,
        actor: req.user,
        type: "reply_comment",
        postId: post._id,
        referenceId: comment._id.toString(),
        message: "replied to your comment.",
        deepLink: `/posts/${post._id.toString()}`,
        push: {
          eventType: "reply_comment",
          title: `${req.user.name} replied to your comment`,
          body: text,
        },
      });
    } else {
      await createNotification({
        recipientId: post.author,
        actor: req.user,
        type: "comment_post",
        postId: post._id,
        referenceId: comment._id.toString(),
        message: "commented on your post.",
        deepLink: `/posts/${post._id.toString()}`,
        push: {
          eventType: "comment_post",
          title: `${req.user.name} commented on your post`,
          body: text,
        },
      });
    }

    return res.status(201).json({
      comment: mapComment(comment),
      commentsCount: post.comments.length,
    });
  } catch (error) {
    return next(error);
  }
};

const deleteComment = async (req, res, next) => {
  try {
    const { postId, commentId } = req.params;
    const post = await Post.findById(postId);

    if (!post) {
      throw createHttpError(404, "Post not found");
    }

    const comment = post.comments.id(commentId);
    if (!comment) {
      throw createHttpError(404, "Comment not found");
    }

    if (comment.author.toString() !== req.user._id.toString()) {
      throw createHttpError(403, "You can only delete your own comments");
    }

    const idsToDelete = new Set([commentId]);
    let changed = true;

    while (changed) {
      changed = false;

      for (const currentComment of post.comments) {
        const parentId = currentComment.parentComment
          ? currentComment.parentComment.toString()
          : null;
        const currentId = currentComment._id.toString();

        if (parentId && idsToDelete.has(parentId) && !idsToDelete.has(currentId)) {
          idsToDelete.add(currentId);
          changed = true;
        }
      }
    }

    post.comments = post.comments.filter(
      (currentComment) => !idsToDelete.has(currentComment._id.toString()),
    );
    post.markModified("comments");
    await post.save();
    await deleteNotifications({
      post: post._id,
      referenceId: { $in: [...idsToDelete] },
      type: { $in: ["comment_post", "reply_comment"] },
    });

    return res.status(200).json({
      message: "Comment deleted",
      commentsCount: post.comments.length,
    });
  } catch (error) {
    return next(error);
  }
};

const deletePost = async (req, res, next) => {
  try {
    const { postId } = req.params;
    const post = await Post.findById(postId);

    if (!post) {
      throw createHttpError(404, "Post not found");
    }

    if (post.author.toString() !== req.user._id.toString()) {
      throw createHttpError(403, "You can delete only your own posts");
    }

    await deleteNotifications({ post: post._id });
    await Post.deleteOne({ _id: postId });
    return res.status(200).json({ message: "Post deleted" });
  } catch (error) {
    return next(error);
  }
};

const seedPosts = async (_req, res, next) => {
  try {
    // Check if posts already exist
    const existingCount = await Post.countDocuments();
    if (existingCount > 0) {
      return res
        .status(200)
        .json({ message: "Posts already seeded", count: existingCount });
    }

    // Create seed users
    const hash = await bcrypt.hash("password123", 10);
    const seedUsers = await User.insertMany([
      {
        name: "Urgoo Cinema",
        email: "urgoo@seed.com",
        passwordHash: hash,
        avatarUrl:
          "https://public.youware.com/users-website-assets/prod/a75881b7-308c-4271-80ce-76a6227bc546/c85092476493499e9c7bcf274a7868a0.jpg",
        bio: "Your daily dose of cinema 🎬",
      },
      {
        name: "Nature Collective",
        email: "nature@seed.com",
        passwordHash: hash,
        avatarUrl:
          "https://public.youware.com/users-website-assets/prod/a75881b7-308c-4271-80ce-76a6227bc546/5fb5f9df61ed4df3a886fd97ecd87794.jpg",
        bio: "Connecting you with nature 🌿",
      },
      {
        name: "Sarnai Tsetseg",
        email: "sarnai@seed.com",
        passwordHash: hash,
        avatarUrl: "https://i.pravatar.cc/150?img=13",
        bio: "Runner & dreamer 🏃‍♀️",
      },
      {
        name: "Enkhjin Bat",
        email: "enkhjin@seed.com",
        passwordHash: hash,
        avatarUrl: "https://i.pravatar.cc/150?img=15",
        bio: "Developer & creator 🖥️",
      },
    ]);

    // Create seed posts
    const posts = await Post.insertMany([
      {
        author: seedUsers[0]._id,
        text: 'Christopher Nolan\'s "The Dark Knight" inspired Timothee Chalamet to become an actor. A masterpiece that changed cinema forever. 🎬✨',
        imageUrl:
          "https://public.youware.com/users-website-assets/prod/a75881b7-308c-4271-80ce-76a6227bc546/f5d02131c15447ea9320de112b4b1f67.jpg",
        imageUrls: [
          "https://public.youware.com/users-website-assets/prod/a75881b7-308c-4271-80ce-76a6227bc546/f5d02131c15447ea9320de112b4b1f67.jpg",
        ],
        likes: [seedUsers[1]._id, seedUsers[2]._id, seedUsers[3]._id],
        comments: [
          { author: seedUsers[1]._id, text: "Absolutely iconic film!" },
          { author: seedUsers[2]._id, text: "Heath Ledger was legendary 🃏" },
        ],
      },
      {
        author: seedUsers[1]._id,
        text: "Silence speaks when words can't. The winter solitude is magical. ❄️🏔️",
        imageUrl:
          "https://public.youware.com/users-website-assets/prod/a75881b7-308c-4271-80ce-76a6227bc546/5fb5f9df61ed4df3a886fd97ecd87794.jpg",
        imageUrls: [
          "https://public.youware.com/users-website-assets/prod/a75881b7-308c-4271-80ce-76a6227bc546/5fb5f9df61ed4df3a886fd97ecd87794.jpg",
        ],
        likes: [seedUsers[0]._id, seedUsers[3]._id],
        comments: [{ author: seedUsers[3]._id, text: "This is breathtaking!" }],
      },
      {
        author: seedUsers[2]._id,
        text: "Just finished my first marathon! 🏃‍♀️ So proud of this achievement! Never give up on your dreams 💪",
        imageUrl: "",
        imageUrls: [],
        likes: [seedUsers[0]._id, seedUsers[1]._id, seedUsers[3]._id],
        comments: [
          { author: seedUsers[0]._id, text: "Congratulations!! 🎉" },
          { author: seedUsers[1]._id, text: "You're an inspiration!" },
          { author: seedUsers[3]._id, text: "Amazing work! 💪" },
        ],
      },
      {
        author: seedUsers[3]._id,
        text: "New workspace, new energy! 🖥️✨ Working from home has never felt this good.",
        imageUrl: "https://picsum.photos/800/500?random=6",
        imageUrls: ["https://picsum.photos/800/500?random=6"],
        likes: [seedUsers[2]._id],
        comments: [{ author: seedUsers[2]._id, text: "Love the setup!" }],
      },
    ]);

    return res
      .status(201)
      .json({ message: "Seeded successfully", count: posts.length });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  listPosts,
  getPost,
  getComments,
  createPost,
  toggleLike,
  addComment,
  deleteComment,
  deletePost,
  seedPosts,
};
