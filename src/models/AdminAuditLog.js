const mongoose = require("mongoose");

const adminAuditLogSchema = new mongoose.Schema(
  {
    adminUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    actionType: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
      index: true,
    },
    targetType: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
      index: true,
    },
    targetId: {
      type: String,
      default: "",
      trim: true,
      maxlength: 120,
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true },
);

adminAuditLogSchema.index({ createdAt: -1, actionType: 1 });

adminAuditLogSchema.set("toJSON", {
  transform: (_doc, ret) => {
    ret.id =
      ret?._id?.toString?.() || ret?.id?.toString?.() || "";
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("AdminAuditLog", adminAuditLogSchema);
