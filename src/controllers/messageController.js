const Message = require("../models/Message");
const User = require("../models/User");
const { createHttpError } = require("../utils/httpError");
const { createUserNotification } = require("../utils/notificationCenter");

const toIdString = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value._id) return value._id.toString();
  return value.toString();
};

const hasUserId = (values, userId) =>
  Array.isArray(values) &&
  values.some((value) => toIdString(value) === String(userId));

// GET /api/messages/conversations — list all conversations (latest message per user)
const getConversations = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const messages = await Message.aggregate([
      {
        $match: {
          $or: [{ sender: userId }, { receiver: userId }],
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: {
            $cond: [{ $eq: ["$sender", userId] }, "$receiver", "$sender"],
          },
          lastMessage: { $first: "$$ROOT" },
          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$receiver", userId] },
                    { $eq: ["$read", false] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      { $sort: { "lastMessage.createdAt": -1 } },
      { $limit: 50 },
    ]);

    // Populate the other user's info
    const otherUserIds = messages.map((m) => m._id);
    const users = await User.find({ _id: { $in: otherUserIds } })
      .select("name avatarUrl bio blockedUsers")
      .lean();

    const blockedByCurrent = new Set(
      Array.isArray(req.user.blockedUsers)
        ? req.user.blockedUsers.map((value) => value.toString())
        : [],
    );
    const usersMap = {};
    users.forEach((u) => {
      const targetId = u._id.toString();
      if (blockedByCurrent.has(targetId)) {
        return;
      }
      if (hasUserId(u.blockedUsers, userId.toString())) {
        return;
      }
      usersMap[u._id.toString()] = {
        id: targetId,
        name: u.name,
        avatarUrl: u.avatarUrl || "",
        bio: u.bio || "",
      };
    });

    const conversations = messages
      .filter((m) => usersMap[m._id.toString()])
      .map((m) => ({
        user: usersMap[m._id.toString()],
        lastMessage: {
          id: m.lastMessage._id.toString(),
          text: m.lastMessage.text,
          senderId: m.lastMessage.sender.toString(),
          createdAt: m.lastMessage.createdAt,
        },
        unreadCount: m.unreadCount,
      }));

    return res.status(200).json({ conversations });
  } catch (error) {
    return next(error);
  }
};

// GET /api/messages/:userId — get messages between current user and :userId
const getMessages = async (req, res, next) => {
  try {
    const currentUserId = req.user._id;
    const otherUserId = req.params.userId;

    const otherUser = await User.findById(otherUserId);
    if (!otherUser) {
      throw createHttpError(404, "User not found");
    }
    if (
      hasUserId(req.user.blockedUsers, otherUserId) ||
      hasUserId(otherUser.blockedUsers, currentUserId.toString())
    ) {
      throw createHttpError(403, "Chat is blocked");
    }

    const messages = await Message.find({
      $or: [
        { sender: currentUserId, receiver: otherUserId },
        { sender: otherUserId, receiver: currentUserId },
      ],
    })
      .sort({ createdAt: 1 })
      .limit(200)
      .lean();

    // Mark unread messages as read
    await Message.updateMany(
      {
        sender: otherUserId,
        receiver: currentUserId,
        read: false,
      },
      { $set: { read: true } },
    );

    const result = messages.map((m) => ({
      id: m._id.toString(),
      senderId: m.sender.toString(),
      receiverId: m.receiver.toString(),
      text: m.text,
      read: m.read,
      createdAt: m.createdAt,
    }));

    return res.status(200).json({
      messages: result,
      otherUser: otherUser.toJSON(),
    });
  } catch (error) {
    return next(error);
  }
};

// POST /api/messages/:userId — send a message to :userId
const sendMessage = async (req, res, next) => {
  try {
    const currentUserId = req.user._id;
    const otherUserId = req.params.userId;
    const { text } = req.body;

    if (!text || text.trim().length === 0) {
      throw createHttpError(400, "Message text is required");
    }

    const otherUser = await User.findById(otherUserId);
    if (!otherUser) {
      throw createHttpError(404, "User not found");
    }
    if (
      hasUserId(req.user.blockedUsers, otherUserId) ||
      hasUserId(otherUser.blockedUsers, currentUserId.toString())
    ) {
      throw createHttpError(403, "Chat is blocked");
    }

    const message = await Message.create({
      sender: currentUserId,
      receiver: otherUserId,
      text: text.trim(),
    });

    try {
      await createUserNotification({
        userId: otherUserId,
        type: "dm",
        title: req.user?.name || "New message",
        body: message.text,
        data: {
          type: "dm",
          userId: currentUserId.toString(),
          userName: req.user?.name || "",
          messageId: message._id.toString(),
        },
        push: {
          enabled: true,
          tokens: otherUser.expoPushTokens || [],
          channelId: "messages",
        },
      });
    } catch (notificationError) {
      console.warn("[dm] notification dispatch failed:", notificationError);
    }

    return res.status(201).json({
      message: {
        id: message._id.toString(),
        senderId: message.sender.toString(),
        receiverId: message.receiver.toString(),
        text: message.text,
        read: message.read,
        createdAt: message.createdAt,
      },
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getConversations,
  getMessages,
  sendMessage,
};
