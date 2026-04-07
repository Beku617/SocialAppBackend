const mongoose = require("mongoose");

const reelReportSchema = new mongoose.Schema(
  {
    reel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Reel",
      required: true,
      index: true,
    },
    reporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    reason: {
      type: String,
      required: true,
      enum: [
        "spam",
        "harassment",
        "hate_speech",
        "violence",
        "nudity",
        "false_information",
        "other",
      ],
      index: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
    status: {
      type: String,
      enum: ["open", "reviewed"],
      default: "open",
      index: true,
    },
  },
  { timestamps: true },
);

reelReportSchema.index({ reel: 1, reporter: 1 }, { unique: true });

module.exports = mongoose.model("ReelReport", reelReportSchema);
