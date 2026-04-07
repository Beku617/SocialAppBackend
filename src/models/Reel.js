const mongoose = require("mongoose");

const visibilityValues = ["public", "friends", "followers", "private"];
const statusValues = ["uploading", "processing", "ready", "failed"];

const reelSchema = new mongoose.Schema(
  {
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    caption: {
      type: String,
      default: "",
      trim: true,
      maxlength: 2200,
    },
    music: {
      type: String,
      default: "",
      trim: true,
      maxlength: 180,
    },
    storageKey: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    originalUrl: {
      type: String,
      default: "",
      trim: true,
    },
    playbackUrl: {
      type: String,
      default: "",
      trim: true,
    },
    thumbUrl: {
      type: String,
      default: "",
      trim: true,
    },
    duration: {
      type: Number,
      default: 0,
      min: 0,
    },
    width: {
      type: Number,
      default: 0,
      min: 0,
    },
    height: {
      type: Number,
      default: 0,
      min: 0,
    },
    visibility: {
      type: String,
      enum: visibilityValues,
      default: "public",
      index: true,
    },
    status: {
      type: String,
      enum: statusValues,
      default: "uploading",
      index: true,
    },
    failureReason: {
      type: String,
      default: "",
      trim: true,
      maxlength: 280,
    },
    likes: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    saves: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    viewers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    likesCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    commentsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    viewsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    repostsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    sharesCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    savesCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    processedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

reelSchema.set("toJSON", {
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("Reel", reelSchema);
