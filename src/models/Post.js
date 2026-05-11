const mongoose = require("mongoose");

const commentMentionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60,
    },
    start: {
      type: Number,
      required: true,
      min: 0,
    },
    end: {
      type: Number,
      required: true,
      min: 1,
    },
  },
  { _id: false },
);

const commentSchema = new mongoose.Schema(
  {
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 500,
    },
    parentComment: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    mentions: {
      type: [commentMentionSchema],
      default: [],
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

commentSchema.set("toJSON", {
  transform: (_doc, ret) => {
    ret.id =
      ret?._id?.toString?.() || ret?.id?.toString?.() || "";
    ret.parentCommentId = ret.parentComment ? ret.parentComment.toString() : null;
    ret.mentions = Array.isArray(ret.mentions)
      ? ret.mentions.map((mention) => ({
          userId:
            mention.user?._id?.toString?.() ||
            mention.user?.id?.toString?.() ||
            mention.user?.toString?.() ||
            "",
          name: mention.name || mention.user?.name || "",
          avatarUrl: mention.user?.avatarUrl || "",
          start: mention.start,
          end: mention.end,
        }))
      : [];
    delete ret._id;
    delete ret.parentComment;
    return ret;
  },
});

const postSchema = new mongoose.Schema(
  {
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    text: {
      type: String,
      default: "",
      trim: true,
      maxlength: 2200,
    },
    imageUrl: {
      type: String,
      default: "",
      trim: true,
    },
    imageUrls: {
      type: [String],
      default: [],
      set: (urls) => {
        if (!Array.isArray(urls)) return [];
        // Normalize: trim strings & drop empties
        return urls
          .map((u) => (typeof u === "string" ? u.trim() : ""))
          .filter((u) => u.length > 0);
      },
    },
    likes: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    comments: [commentSchema],
  },
  { timestamps: true }
);

postSchema.pre("validate", function validatePostContent() {
  const hasText = typeof this.text === "string" && this.text.trim().length > 0;
  const hasSingleImage =
    typeof this.imageUrl === "string" && this.imageUrl.trim().length > 0;
  const hasImageArray =
    Array.isArray(this.imageUrls) &&
    this.imageUrls.some((url) => typeof url === "string" && url.trim().length > 0);

  // Keep the legacy single field in sync with the array for compatibility
  if (!hasImageArray && hasSingleImage) {
    this.imageUrls = [this.imageUrl.trim()];
  } else if (hasImageArray && !hasSingleImage) {
    this.imageUrl = this.imageUrls[0];
  }

  const hasAnyImage = hasSingleImage || hasImageArray;

  if (!hasText && !hasAnyImage) {
    this.invalidate("text", "Post must include text or image");
  }
});

postSchema.set("toJSON", {
  transform: (_doc, ret) => {
    // Ensure both shapes are available to clients
    if ((!ret.imageUrl || ret.imageUrl.length === 0) && Array.isArray(ret.imageUrls) && ret.imageUrls.length > 0) {
      ret.imageUrl = ret.imageUrls[0];
    }
    if (!Array.isArray(ret.imageUrls) || ret.imageUrls.length === 0) {
      ret.imageUrls = ret.imageUrl ? [ret.imageUrl] : [];
    }
    ret.id =
      ret?._id?.toString?.() || ret?.id?.toString?.() || "";
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("Post", postSchema);
