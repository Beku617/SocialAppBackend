const mongoose = require("mongoose");

const buildPairKey = (requester, recipient) =>
  [requester?.toString?.() || "", recipient?.toString?.() || ""].sort().join(":");

const friendRequestSchema = new mongoose.Schema(
  {
    requester: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    pairKey: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "declined", "canceled"],
      default: "pending",
      index: true,
    },
    respondedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

friendRequestSchema.pre("validate", function setPairKey() {
  if (this.requester && this.recipient) {
    this.pairKey = buildPairKey(this.requester, this.recipient);
  }
});

friendRequestSchema.index(
  { pairKey: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "pending" },
  },
);

friendRequestSchema.set("toJSON", {
  transform: (_doc, ret) => {
    ret.id =
      ret?._id?.toString?.() || ret?.id?.toString?.() || "";
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("FriendRequest", friendRequestSchema);
