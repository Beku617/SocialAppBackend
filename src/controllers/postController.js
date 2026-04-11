const mongoose = require("mongoose");
const Post = require("../models/Post");
const Report = require("../models/Report");
const User = require("../models/User");
const { createHttpError } = require("../utils/httpError");
const { normalizeImageUrls, serializePost } = require("../utils/serializePost");
const { createUserNotification } = require("../utils/notificationCenter");
const {
  canViewerSeeContent,
  normalizeVisibilityInput,
} = require("../utils/visibility");
const bcrypt = require("bcryptjs");

const toIdString = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value._id) return value._id.toString();
  return value.toString();
};

const normalizePostVisibility = (value) => {
  return normalizeVisibilityInput(value, { errorMessage: "Invalid post visibility" });
};

const buildFriendIdSet = (user) =>
  new Set(Array.isArray(user?.friends) ? user.friends.map(toIdString) : []);

const buildBlockedIdSet = (user) =>
  new Set(
    Array.isArray(user?.blockedUsers) ? user.blockedUsers.map(toIdString) : [],
  );

const isBlockedAuthor = (post, blockedIdSet) =>
  blockedIdSet.has(toIdString(post?.author));

const canViewerSeePost = (post, viewerId, friendIdSet) => {
  return canViewerSeeContent({
    visibility: post?.visibility,
    authorId: toIdString(post?.author),
    viewerId,
    friendIdSet,
  });
};

const flattenComments = (comments) => {
  if (!Array.isArray(comments) || comments.length === 0) return [];
  const stack = [...comments];
  const result = [];
  while (stack.length) {
    const next = stack.shift();
    result.push(next);
    if (Array.isArray(next?.replies) && next.replies.length > 0) {
      stack.unshift(...next.replies);
    }
  }
  return result;
};

const listPosts = async (req, res, next) => {
  try {
    const viewerId = req.user._id.toString();
    const friendIdSet = buildFriendIdSet(req.user);
    const blockedIdSet = buildBlockedIdSet(req.user);
    const posts = await Post.find()
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("author", "name avatarUrl")
      .populate({
        path: "sharedPost",
        populate: {
          path: "author",
          select: "name avatarUrl",
        },
      })
      .populate("comments.author", "name avatarUrl")
      .lean();

    const visiblePosts = posts
      .filter(
        (post) =>
          !isBlockedAuthor(post, blockedIdSet) &&
          canViewerSeePost(post, viewerId, friendIdSet),
      )
      .map((post) => {
        if (
          post.sharedPost &&
          !canViewerSeePost(post.sharedPost, viewerId, friendIdSet)
        ) {
          post.sharedPost = null;
        }
        return post;
      });

    return res.status(200).json({
      posts: visiblePosts.map((post) => serializePost(post, viewerId)),
    });
  } catch (error) {
    return next(error);
  }
};

const getPost = async (req, res, next) => {
  try {
    const { postId } = req.params;
    const viewerId = req.user._id.toString();
    const friendIdSet = buildFriendIdSet(req.user);
    const blockedIdSet = buildBlockedIdSet(req.user);
    const post = await Post.findById(postId)
      .populate("author", "name avatarUrl")
      .populate({
        path: "sharedPost",
        populate: {
          path: "author",
          select: "name avatarUrl",
        },
      })
      .populate("comments.author", "name avatarUrl")
      .lean();

    if (!post) {
      throw createHttpError(404, "Post not found");
    }

    if (!canViewerSeePost(post, viewerId, friendIdSet)) {
      throw createHttpError(403, "You cannot view this post");
    }
    if (isBlockedAuthor(post, blockedIdSet)) {
      throw createHttpError(404, "Post not found");
    }

    if (
      post.sharedPost &&
      !canViewerSeePost(post.sharedPost, viewerId, friendIdSet)
    ) {
      post.sharedPost = null;
    }

    return res.status(200).json({ post: serializePost(post, viewerId) });
  } catch (error) {
    return next(error);
  }
};

const createPost = async (req, res, next) => {
  try {
    const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
    const imageUrls = normalizeImageUrls(req.body);
    const visibility = normalizePostVisibility(req.body.visibility);

    if (imageUrls.length === 0) {
      throw createHttpError(400, "Post must include at least one image");
    }

    const post = await Post.create({
      author: req.user._id,
      text,
      imageUrl: imageUrls[0] || "",
      imageUrls,
      visibility,
      likes: [],
      comments: [],
      notificationsEnabled: true,
    });

    const createdPost = await Post.findById(post._id)
      .populate("author", "name avatarUrl")
      .populate({
        path: "sharedPost",
        populate: {
          path: "author",
          select: "name avatarUrl",
        },
      })
      .populate("comments.author", "name avatarUrl")
      .lean();

    return res.status(201).json({
      post: serializePost(createdPost, req.user._id.toString()),
    });
  } catch (error) {
    return next(error);
  }
};

const updatePost = async (req, res, next) => {
  try {
    const { postId } = req.params;
    const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
    const imageUrls = normalizeImageUrls(req.body);
    const nextVisibility =
      req.body.visibility !== undefined
        ? normalizePostVisibility(req.body.visibility)
        : null;
    const post = await Post.findById(postId);

    if (!post) {
      throw createHttpError(404, "Post not found");
    }

    if (post.author.toString() !== req.user._id.toString()) {
      throw createHttpError(403, "You can edit only your own posts");
    }

    if (imageUrls.length === 0) {
      throw createHttpError(400, "Post must include at least one image");
    }

    post.text = text;
    post.imageUrl = imageUrls[0] || "";
    post.imageUrls = imageUrls;
    if (nextVisibility) {
      post.visibility = nextVisibility;
    }
    await post.save();

    const updatedPost = await Post.findById(postId)
      .populate("author", "name avatarUrl")
      .populate({
        path: "sharedPost",
        populate: {
          path: "author",
          select: "name avatarUrl",
        },
      })
      .populate("comments.author", "name avatarUrl")
      .lean();

    return res.status(200).json({
      post: serializePost(updatedPost, req.user._id.toString()),
    });
  } catch (error) {
    return next(error);
  }
};

const toggleLike = async (req, res, next) => {
  try {
    const { postId } = req.params;
    const userId = req.user._id.toString();
    const friendIdSet = buildFriendIdSet(req.user);
    const blockedIdSet = buildBlockedIdSet(req.user);
    const post = await Post.findById(postId);

    if (!post) {
      throw createHttpError(404, "Post not found");
    }

    if (!canViewerSeePost(post, userId, friendIdSet)) {
      throw createHttpError(403, "You cannot interact with this post");
    }
    if (isBlockedAuthor(post, blockedIdSet)) {
      throw createHttpError(403, "Action not allowed");
    }

    const currentIndex = post.likes.findIndex((id) => id.toString() === userId);
    const liked = currentIndex === -1;

    if (liked) {
      post.likes.push(new mongoose.Types.ObjectId(userId));
    } else {
      post.likes.splice(currentIndex, 1);
    }

    await post.save();

    const authorId = post.author.toString();
    if (liked && authorId !== userId) {
      const postAuthor = await User.findById(authorId).select(
        "expoPushTokens",
      );
      await createUserNotification({
        userId: authorId,
        type: "post_like",
        title: `${req.user?.name || "Someone"} liked your post`,
        body: post.text
          ? post.text.slice(0, 120)
          : "Someone reacted to your post.",
        data: {
          type: "post_like",
          postId: post._id.toString(),
          actorId: userId,
          actorName: req.user?.name || "",
        },
        push: {
          enabled: post.notificationsEnabled !== false,
          tokens: postAuthor?.expoPushTokens || [],
          channelId: "messages",
        },
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
    const text = String(req.body?.text || "").trim();
    const parentCommentId =
      typeof req.body?.parentCommentId === "string" &&
      req.body.parentCommentId.trim()
        ? req.body.parentCommentId.trim()
        : "";
    const userId = req.user._id.toString();
    const friendIdSet = buildFriendIdSet(req.user);
    const blockedIdSet = buildBlockedIdSet(req.user);
    const post = await Post.findById(postId);

    if (!post) {
      throw createHttpError(404, "Post not found");
    }

    if (!canViewerSeePost(post, userId, friendIdSet)) {
      throw createHttpError(403, "You cannot comment on this post");
    }
    if (isBlockedAuthor(post, blockedIdSet)) {
      throw createHttpError(403, "Action not allowed");
    }

    let parentComment = null;
    let repliedToUserId = "";
    let repliedToUsername = "";

    if (parentCommentId) {
      if (!mongoose.Types.ObjectId.isValid(parentCommentId)) {
        throw createHttpError(400, "Invalid parent comment id");
      }
      parentComment = post.comments.id(parentCommentId);
      if (!parentComment) {
        throw createHttpError(404, "Parent comment not found");
      }

      repliedToUserId = parentComment.author?.toString?.() || "";
      if (repliedToUserId) {
        const repliedUser = await User.findById(repliedToUserId).select(
          "username name",
        );
        repliedToUsername =
          repliedUser?.username ||
          repliedUser?.name ||
          req.body?.repliedToUsername ||
          "";
      }
    }

    const newCommentId = new mongoose.Types.ObjectId();
    post.comments.push({
      _id: newCommentId,
      author: req.user._id,
      text,
      parentComment: parentComment?._id || null,
      repliedToUser: repliedToUserId || null,
      repliedToUsername,
      likes: [],
    });
    await post.save();
    await post.populate("comments.author", "name avatarUrl");

    const serializedPost = serializePost(post, userId);
    const serializedComments = flattenComments(serializedPost.comments);
    const comment =
      serializedComments.find((item) => item.id === newCommentId.toString()) ||
      null;

    const authorId = post.author.toString();
    const actorId = req.user._id.toString();
    if (authorId !== actorId) {
      const postAuthor = await User.findById(authorId).select(
        "expoPushTokens",
      );
      await createUserNotification({
        userId: authorId,
        type: "post_comment",
        title: `${req.user?.name || "Someone"} commented on your post`,
        body: text.slice(0, 160) || "Someone commented on your post.",
        data: {
          type: "post_comment",
          postId: post._id.toString(),
          commentId: newCommentId.toString(),
          actorId,
          actorName: req.user?.name || "",
        },
        push: {
          enabled: post.notificationsEnabled !== false,
          tokens: postAuthor?.expoPushTokens || [],
          channelId: "messages",
        },
      });
    }

    if (
      repliedToUserId &&
      repliedToUserId !== actorId &&
      repliedToUserId !== authorId
    ) {
      try {
        const repliedUser = await User.findById(repliedToUserId).select(
          "expoPushTokens",
        );
        await createUserNotification({
          userId: repliedToUserId,
          type: "post_comment",
          title: `${req.user?.name || "Someone"} replied to your comment`,
          body: text.slice(0, 160) || "Someone replied to your comment.",
          data: {
            type: "post_comment",
            postId: post._id.toString(),
            commentId: newCommentId.toString(),
            actorId,
            actorName: req.user?.name || "",
            isReply: true,
          },
          push: {
            enabled: post.notificationsEnabled !== false,
            tokens: repliedUser?.expoPushTokens || [],
            channelId: "messages",
          },
        });
      } catch (notificationError) {
        console.warn(
          "[post_reply] notification dispatch failed:",
          notificationError,
        );
      }
    }

    return res.status(201).json({
      comment,
      commentsCount: serializedComments.length,
    });
  } catch (error) {
    return next(error);
  }
};

const toggleCommentLike = async (req, res, next) => {
  try {
    const { postId, commentId } = req.params;
    const userId = req.user._id.toString();
    const friendIdSet = buildFriendIdSet(req.user);
    const blockedIdSet = buildBlockedIdSet(req.user);
    const post = await Post.findById(postId);

    if (!post) {
      throw createHttpError(404, "Post not found");
    }

    if (!canViewerSeePost(post, userId, friendIdSet)) {
      throw createHttpError(403, "You cannot interact with this post");
    }
    if (isBlockedAuthor(post, blockedIdSet)) {
      throw createHttpError(403, "Action not allowed");
    }

    const comment = post.comments.id(commentId);
    if (!comment) {
      throw createHttpError(404, "Comment not found");
    }

    const existingIndex = comment.likes.findIndex(
      (id) => id.toString() === userId,
    );
    const liked = existingIndex === -1;

    if (liked) {
      comment.likes.push(new mongoose.Types.ObjectId(userId));
    } else {
      comment.likes.splice(existingIndex, 1);
    }

    await post.save();

    return res.status(200).json({
      liked,
      likeCount: comment.likes.length,
    });
  } catch (error) {
    return next(error);
  }
};

const togglePostNotifications = async (req, res, next) => {
  try {
    const { postId } = req.params;
    const post = await Post.findById(postId);

    if (!post) {
      throw createHttpError(404, "Post not found");
    }

    if (post.author.toString() !== req.user._id.toString()) {
      throw createHttpError(403, "You can update only your own posts");
    }

    post.notificationsEnabled = !post.notificationsEnabled;
    await post.save();

    return res.status(200).json({
      notificationsEnabled: post.notificationsEnabled,
    });
  } catch (error) {
    return next(error);
  }
};

const reportPost = async (req, res, next) => {
  try {
    const { postId } = req.params;
    const userId = req.user._id.toString();
    const friendIdSet = buildFriendIdSet(req.user);
    const blockedIdSet = buildBlockedIdSet(req.user);
    const reason = typeof req.body.reason === "string" ? req.body.reason : "";
    const description =
      typeof req.body.description === "string" ? req.body.description.trim() : "";

    const post = await Post.findById(postId).select("_id author");
    if (!post) {
      throw createHttpError(404, "Post not found");
    }

    if (!canViewerSeePost(post, userId, friendIdSet)) {
      throw createHttpError(403, "You cannot report this post");
    }
    if (isBlockedAuthor(post, blockedIdSet)) {
      throw createHttpError(403, "Action not allowed");
    }

    await Report.create({
      post: post._id,
      reporter: req.user._id,
      reason,
      description,
      status: "open",
    });

    return res.status(201).json({ message: "Report submitted" });
  } catch (error) {
    return next(error);
  }
};

const sharePost = async (req, res, next) => {
  try {
    const { postId } = req.params;
    const userId = req.user._id.toString();
    const friendIdSet = buildFriendIdSet(req.user);
    const blockedIdSet = buildBlockedIdSet(req.user);
    const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
    const visibility = normalizePostVisibility(req.body.visibility);

    const originalPost = await Post.findById(postId)
      .populate("author", "name avatarUrl")
      .lean();

    if (!originalPost) {
      throw createHttpError(404, "Post not found");
    }

    if (!canViewerSeePost(originalPost, userId, friendIdSet)) {
      throw createHttpError(403, "You cannot share this post");
    }
    if (isBlockedAuthor(originalPost, blockedIdSet)) {
      throw createHttpError(403, "Action not allowed");
    }

    const shared = await Post.create({
      author: req.user._id,
      text,
      imageUrl: "",
      imageUrls: [],
      visibility,
      sharedPost: originalPost._id,
      likes: [],
      comments: [],
      notificationsEnabled: true,
    });

    const createdPost = await Post.findById(shared._id)
      .populate("author", "name avatarUrl")
      .populate({
        path: "sharedPost",
        populate: {
          path: "author",
          select: "name avatarUrl",
        },
      })
      .populate("comments.author", "name avatarUrl")
      .lean();

    return res.status(201).json({
      post: serializePost(createdPost, req.user._id.toString()),
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
        likes: [seedUsers[0]._id, seedUsers[3]._id],
        comments: [{ author: seedUsers[3]._id, text: "This is breathtaking!" }],
      },
      {
        author: seedUsers[2]._id,
        text: "Just finished my first marathon! 🏃‍♀️ So proud of this achievement! Never give up on your dreams 💪",
        imageUrl: "https://picsum.photos/800/500?random=7",
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
  createPost,
  updatePost,
  toggleLike,
  addComment,
  toggleCommentLike,
  reportPost,
  sharePost,
  togglePostNotifications,
  deletePost,
  seedPosts,
};
