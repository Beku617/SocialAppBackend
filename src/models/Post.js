const mongoose = require("mongoose");
const { VISIBILITY_VALUES } = require("../utils/visibility");

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
    repliedToUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    repliedToUsername: {
      type: String,
      default: "",
      trim: true,
      maxlength: 30,
    },
    likes: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

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
    },
    visibility: {
      type: String,
      enum: VISIBILITY_VALUES,
      default: "public",
      index: true,
    },
    sharedPost: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      default: null,
    },
    likes: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    comments: [commentSchema],
    notificationsEnabled: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

postSchema.set("toJSON", {
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

postSchema.index({ "comments.parentComment": 1 });
postSchema.index({ "comments.author": 1 });

module.exports = mongoose.model("Post", postSchema);
