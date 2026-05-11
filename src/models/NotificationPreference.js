const mongoose = require("mongoose");

const notificationPreferenceSchema = new mongoose.Schema(
  {
    scope: {
      type: String,
      default: "global",
      unique: true,
      trim: true,
    },
    pushEnabled: {
      type: Boolean,
      default: true,
    },
    messagePushEnabled: {
      type: Boolean,
      default: true,
    },
    friendRequestPushEnabled: {
      type: Boolean,
      default: true,
    },
    friendAcceptPushEnabled: {
      type: Boolean,
      default: true,
    },
    likePushEnabled: {
      type: Boolean,
      default: true,
    },
    commentPushEnabled: {
      type: Boolean,
      default: true,
    },
    replyPushEnabled: {
      type: Boolean,
      default: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model(
  "NotificationPreference",
  notificationPreferenceSchema,
);
