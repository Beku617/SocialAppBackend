const mongoose = require("mongoose");

const adminNotificationCampaignSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    audienceType: {
      type: String,
      enum: ["single", "selected", "all"],
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    body: {
      type: String,
      required: true,
      trim: true,
      maxlength: 280,
    },
    category: {
      type: String,
      default: "announcement",
      trim: true,
      maxlength: 40,
    },
    deepLink: {
      type: String,
      default: "",
      trim: true,
      maxlength: 160,
    },
    status: {
      type: String,
      enum: ["queued", "processing", "completed", "completed_with_errors", "failed"],
      default: "queued",
      index: true,
    },
    processingMode: {
      type: String,
      enum: ["immediate", "batched"],
      default: "immediate",
    },
    recipientIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "User",
      default: [],
      select: false,
    },
    recipientCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    requestedRecipientCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    skippedRecipientCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    invalidRecipientCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    inAppCreatedCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    failedRecipientCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    pushRequested: {
      type: Boolean,
      default: false,
    },
    pushAttemptedCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    pushDeliveredCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    pushSkippedCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    pushFailedCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    clientRequestId: {
      type: String,
      default: undefined,
      trim: true,
      maxlength: 120,
      index: true,
    },
    idempotencyKey: {
      type: String,
      default: undefined,
      trim: true,
      maxlength: 128,
      unique: true,
      sparse: true,
    },
    payloadHash: {
      type: String,
      default: "",
      trim: true,
      maxlength: 128,
      index: true,
    },
    lastError: {
      type: String,
      default: "",
      trim: true,
      maxlength: 400,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

adminNotificationCampaignSchema.index({ sender: 1, payloadHash: 1, createdAt: -1 });
adminNotificationCampaignSchema.index({ status: 1, createdAt: 1 });

adminNotificationCampaignSchema.set("toJSON", {
  transform: (_doc, ret) => {
    ret.id =
      ret?._id?.toString?.() || ret?.id?.toString?.() || "";
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model(
  "AdminNotificationCampaign",
  adminNotificationCampaignSchema,
);
