const mongoose = require("mongoose");

const storySchema = new mongoose.Schema(
  {
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    imageUrl: {
      type: String,
      required: true,
    },
    caption: {
      type: String,
      default: "",
      maxlength: 200,
      trim: true,
    },
    imageFit: {
      type: String,
      enum: ["cover", "contain"],
      default: "cover",
    },
    textOverlay: {
      text: {
        type: String,
        default: "",
        maxlength: 200,
        trim: true,
      },
      x: {
        type: Number,
        default: 0.5,
        min: 0,
        max: 1,
      },
      y: {
        type: Number,
        default: 0.32,
        min: 0,
        max: 1,
      },
      scale: {
        type: Number,
        default: 0.09,
        min: 0.05,
        max: 0.18,
      },
    },
    viewers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 }, // TTL index – MongoDB auto-deletes expired docs
    },
  },
  { timestamps: true },
);

storySchema.set("toJSON", {
  transform: (_doc, ret) => {
    ret.id =
      ret?._id?.toString?.() || ret?.id?.toString?.() || "";
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("Story", storySchema);
