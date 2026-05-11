const mongoose = require("mongoose");

const reelCommentMentionSchema = new mongoose.Schema(
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

const reelCommentSchema = new mongoose.Schema(
  {
    reel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Reel",
      required: true,
      index: true,
    },
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
      ref: "ReelComment",
      default: null,
      index: true,
    },
    mentions: {
      type: [reelCommentMentionSchema],
      default: [],
    },
    likes: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    dislikes: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

reelCommentSchema.set("toJSON", {
  transform: (_doc, ret) => {
    ret.id =
      ret?._id?.toString?.() || ret?.id?.toString?.() || "";
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("ReelComment", reelCommentSchema);
