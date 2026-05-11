require("dotenv").config();
const mongoose = require("mongoose");
const { connectDb } = require("../config/db");
const { env, validateEnv } = require("../config/env");
const Post = require("../models/Post");

const noMediaQuery = {
  sharedPost: null,
  $and: [
    {
      $or: [{ imageUrl: { $exists: false } }, { imageUrl: null }, { imageUrl: "" }],
    },
    {
      $or: [
        { imageUrls: { $exists: false } },
        { imageUrls: null },
        { imageUrls: { $size: 0 } },
      ],
    },
  ],
};

const run = async () => {
  const apply = process.argv.includes("--apply");

  try {
    validateEnv();
    await connectDb(env.MONGODB_URI);

    const posts = await Post.find(noMediaQuery)
      .select("_id author text sharedPost createdAt")
      .sort({ createdAt: 1 })
      .lean();

    if (posts.length === 0) {
      console.log("[cleanup-text-only-posts] No text-only posts found.");
      return;
    }

    console.log(
      `[cleanup-text-only-posts] Found ${posts.length} text-only posts without media.`,
    );
    posts.slice(0, 20).forEach((post) => {
      const preview =
        typeof post.text === "string" && post.text.trim()
          ? post.text.trim().slice(0, 60)
          : "(empty text)";
      console.log(
        `[cleanup-text-only-posts] id=${post._id} author=${post.author} createdAt=${post.createdAt?.toISOString?.() || post.createdAt} text="${preview}"`,
      );
    });
    if (posts.length > 20) {
      console.log(
        `[cleanup-text-only-posts] ...and ${posts.length - 20} more posts.`,
      );
    }

    if (!apply) {
      console.log(
        "[cleanup-text-only-posts] Dry run complete. Re-run with --apply to delete these posts.",
      );
      return;
    }

    const ids = posts.map((post) => post._id);
    const result = await Post.deleteMany({ _id: { $in: ids } });
    console.log(
      `[cleanup-text-only-posts] Deleted ${result.deletedCount || 0} posts.`,
    );
  } catch (error) {
    console.error("[cleanup-text-only-posts] Failed:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

void run();
