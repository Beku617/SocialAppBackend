const mongoose = require("mongoose");

const pushTokenSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    expoPushToken: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    platform: {
      type: String,
      enum: ["ios", "android", "web", "unknown"],
      default: "unknown",
    },
    deviceId: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    deviceName: {
      type: String,
      default: "",
      trim: true,
    },
    appVersion: {
      type: String,
      default: "",
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastRegisteredAt: {
      type: Date,
      default: Date.now,
    },
    lastSentAt: {
      type: Date,
      default: null,
    },
    lastError: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { timestamps: true },
);

pushTokenSchema.index({ user: 1, isActive: 1 });

module.exports = mongoose.model("PushToken", pushTokenSchema);
