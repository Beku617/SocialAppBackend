const mongoose = require("mongoose");

const notificationTypes = [
  "chat_message",
  "follow",
  "friend_request",
  "friend_accept",
  "like_post",
  "comment_post",
  "reply_comment",
  "like_reel",
  "reply_reel_comment",
  "admin_message",
];

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    actorName: {
      type: String,
      default: "",
      trim: true,
      maxlength: 80,
    },
    actorAvatarUrl: {
      type: String,
      default: "",
      trim: true,
    },
    type: {
      type: String,
      enum: notificationTypes,
      required: true,
      index: true,
    },
    post: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      default: null,
      index: true,
    },
    reel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Reel",
      default: null,
      index: true,
    },
    referenceId: {
      type: String,
      default: "",
      trim: true,
      maxlength: 64,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 280,
    },
    title: {
      type: String,
      default: "",
      trim: true,
      maxlength: 80,
    },
    category: {
      type: String,
      default: "activity",
      trim: true,
      maxlength: 40,
    },
    deepLink: {
      type: String,
      default: "",
      trim: true,
      maxlength: 160,
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    readAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index(
  { recipient: 1, type: 1, referenceId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      type: "admin_message",
      referenceId: { $exists: true, $gt: "" },
    },
  },
);

notificationSchema.set("toJSON", {
  transform: (_doc, ret) => {
    ret.id =
      ret?._id?.toString?.() || ret?.id?.toString?.() || "";
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("Notification", notificationSchema);
