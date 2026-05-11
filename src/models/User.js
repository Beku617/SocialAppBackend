const mongoose = require("mongoose");

const recentSearchSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ["query", "user"],
      required: true,
    },
    query: {
      type: String,
      default: "",
      trim: true,
      maxlength: 120,
    },
    targetUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    targetUserName: {
      type: String,
      default: "",
      trim: true,
      maxlength: 60,
    },
    targetUserAvatarUrl: {
      type: String,
      default: "",
      trim: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true, id: false },
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 60,
    },
    username: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
      minlength: 3,
      maxlength: 32,
      index: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    refreshTokenHash: {
      type: String,
      default: null,
      select: false,
    },
    refreshTokenExpiresAt: {
      type: Date,
      default: null,
      select: false,
    },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
      index: true,
    },
    accountStatus: {
      type: String,
      enum: ["active", "suspended", "banned", "deactivated"],
      default: "active",
      index: true,
    },
    statusReason: {
      type: String,
      default: "",
      trim: true,
      maxlength: 240,
    },
    statusUpdatedAt: {
      type: Date,
      default: null,
    },
    statusUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
    avatarUrl: {
      type: String,
      default: "",
      trim: true,
    },
    bio: {
      type: String,
      default: "",
      maxlength: 160,
      trim: true,
    },
    recentSearches: {
      type: [recentSearchSchema],
      default: [],
    },
    friends: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    followers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    following: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true },
);

userSchema.set("toJSON", {
  transform: (_doc, ret) => {
    ret.id =
      ret?._id?.toString?.() || ret?.id?.toString?.() || "";
    delete ret._id;
    delete ret.__v;
    delete ret.passwordHash;
    return ret;
  },
});

module.exports = mongoose.model("User", userSchema);
