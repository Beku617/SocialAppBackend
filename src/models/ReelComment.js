const mongoose = require("mongoose");

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
    repliedToUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
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
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

reelCommentSchema.index({ reel: 1, parentComment: 1, createdAt: 1 });

module.exports = mongoose.model("ReelComment", reelCommentSchema);
