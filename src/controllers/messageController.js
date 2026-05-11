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

const areUsersFriends = (firstUser, secondUserId, secondUser) => {
  const firstUserId = toIdString(firstUser?._id);
  return (
    hasUserId(firstUser?.friends, secondUserId) ||
    hasUserId(secondUser?.friends, firstUserId)
  );
};

const NOTES_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_NOTE_LENGTH = 120;

const isActiveNote = (text, updatedAt, nowMs) => {
  if (!text || !String(text).trim()) return false;
  if (!updatedAt) return false;
  const ts = new Date(updatedAt).getTime();
  if (!Number.isFinite(ts)) return false;
  return nowMs - ts <= NOTES_TTL_MS;
};

// GET /api/messages/conversations — list all conversations (latest message per user)
const getConversations = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const messages = await Message.aggregate([
      {
        $match: {
          $and: [
            { $or: [{ sender: userId }, { receiver: userId }] },
            { requestStatus: { $ne: "pending" } },
          ],
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

// GET /api/messages/requests — list incoming pending message requests
const getRequests = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const incoming = await Message.aggregate([
      {
        $match: {
          receiver: userId,
          requestStatus: "pending",
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$sender",
          lastMessage: { $first: "$$ROOT" },
          pendingCount: { $sum: 1 },
        },
      },
      { $sort: { "lastMessage.createdAt": -1 } },
      { $limit: 50 },
    ]);

    const senderIds = incoming.map((item) => item._id);
    const users = await User.find({ _id: { $in: senderIds } })
      .select("name avatarUrl bio blockedUsers")
      .lean();

    const blockedByCurrent = new Set(
      Array.isArray(req.user.blockedUsers)
        ? req.user.blockedUsers.map((value) => value.toString())
        : [],
    );
    const usersMap = {};
    users.forEach((user) => {
      const senderId = user._id.toString();
      if (blockedByCurrent.has(senderId)) return;
      if (hasUserId(user.blockedUsers, userId.toString())) return;
      usersMap[senderId] = {
        id: senderId,
        name: user.name || "User",
        avatarUrl: user.avatarUrl || "",
        bio: user.bio || "",
      };
    });

    const requests = incoming
      .filter((item) => usersMap[item._id.toString()])
      .map((item) => ({
        user: usersMap[item._id.toString()],
        lastMessage: {
          id: item.lastMessage._id.toString(),
          text: item.lastMessage.text,
          senderId: item.lastMessage.sender.toString(),
          createdAt: item.lastMessage.createdAt,
        },
        unreadCount: item.pendingCount,
      }));

    return res.status(200).json({ requests });
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
      requestStatus: m.requestStatus || "accepted",
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
    const currentUserIdStr = currentUserId.toString();
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
      hasUserId(otherUser.blockedUsers, currentUserIdStr)
    ) {
      throw createHttpError(403, "Chat is blocked");
    }

    const usersAreFriends = areUsersFriends(req.user, otherUserId, otherUser);
    let requestStatus = "accepted";

    if (!usersAreFriends) {
      const conversationFilter = {
        $or: [
          { sender: currentUserId, receiver: otherUserId },
          { sender: otherUserId, receiver: currentUserId },
        ],
      };
      const [hasAcceptedConversation, pendingOutgoing, pendingIncoming] =
        await Promise.all([
          Message.exists({
            ...conversationFilter,
            requestStatus: { $ne: "pending" },
          }),
          Message.exists({
            sender: currentUserId,
            receiver: otherUserId,
            requestStatus: "pending",
          }),
          Message.exists({
            sender: otherUserId,
            receiver: currentUserId,
            requestStatus: "pending",
          }),
        ]);

      if (!hasAcceptedConversation) {
        if (pendingOutgoing) {
          throw createHttpError(403, "Message request is pending");
        }
        if (pendingIncoming) {
          throw createHttpError(
            403,
            "You have a pending message request from this user",
          );
        }
        requestStatus = "pending";
      }
    }

    const message = await Message.create({
      sender: currentUserId,
      receiver: otherUserId,
      text: text.trim(),
      requestStatus,
    });

    try {
      console.log(
        "[dm] receiver expoPushTokens value:",
        otherUser.expoPushTokens,
        "receiverId:",
        otherUserId.toString(),
      );
      const senderTokens = Array.isArray(req.user?.expoPushTokens)
        ? req.user.expoPushTokens
        : [];
      const receiverTokens = Array.isArray(otherUser.expoPushTokens)
        ? otherUser.expoPushTokens.filter(
            (token) => !senderTokens.includes(token),
          )
        : [];

      await createUserNotification({
        userId: otherUserId,
        type: "dm",
        title: req.user?.name || "New message",
        body: message.text,
        data: {
          type: requestStatus === "pending" ? "dm_request" : "dm",
          userId: currentUserId.toString(),
          userName: req.user?.name || "",
          messageId: message._id.toString(),
        },
        push: {
          enabled: true,
          tokens: receiverTokens,
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
        requestStatus: message.requestStatus || "accepted",
        createdAt: message.createdAt,
      },
      requestPending: message.requestStatus === "pending",
    });
  } catch (error) {
    return next(error);
  }
};

// POST /api/messages/requests/:userId/accept — accept incoming request from :userId
const acceptRequest = async (req, res, next) => {
  try {
    const currentUserId = req.user._id;
    const senderUserId = req.params.userId;

    const sender = await User.findById(senderUserId).select("_id");
    if (!sender) {
      throw createHttpError(404, "User not found");
    }

    const result = await Message.updateMany(
      {
        sender: senderUserId,
        receiver: currentUserId,
        requestStatus: "pending",
      },
      { $set: { requestStatus: "accepted" } },
    );

    if (!result.modifiedCount) {
      throw createHttpError(404, "Message request not found");
    }

    return res.status(200).json({
      message: "Request accepted",
      acceptedCount: result.modifiedCount,
    });
  } catch (error) {
    return next(error);
  }
};

// DELETE /api/messages/requests/:userId — delete incoming request from :userId
const deleteRequest = async (req, res, next) => {
  try {
    const currentUserId = req.user._id;
    const senderUserId = req.params.userId;

    await Message.deleteMany({
      sender: senderUserId,
      receiver: currentUserId,
      requestStatus: "pending",
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    return next(error);
  }
};

// POST /api/messages/requests/:userId/block — block sender + remove pending request
const blockRequestSender = async (req, res, next) => {
  try {
    const currentUserId = req.user._id.toString();
    const senderUserId = req.params.userId;

    const sender = await User.findById(senderUserId).select("_id blockedUsers");
    if (!sender) {
      throw createHttpError(404, "User not found");
    }

    if (!hasUserId(req.user.blockedUsers, senderUserId)) {
      req.user.blockedUsers.push(sender._id);
      await req.user.save();
    }

    await Message.deleteMany({
      sender: senderUserId,
      receiver: currentUserId,
      requestStatus: "pending",
    });

    return res.status(200).json({
      message: "User blocked",
      blockedUserId: senderUserId,
    });
  } catch (error) {
    return next(error);
  }
};

// GET /api/messages/notes — list friend-visible notes + my note
const getFriendNotes = async (req, res, next) => {
  try {
    const currentUserId = req.user._id.toString();
    const nowMs = Date.now();
    const friendIds = Array.isArray(req.user.friends) ? req.user.friends : [];
    const blockedByCurrent = new Set(
      Array.isArray(req.user.blockedUsers)
        ? req.user.blockedUsers.map((value) => toIdString(value))
        : [],
    );

    const friends = await User.find({ _id: { $in: friendIds } })
      .select("name avatarUrl blockedUsers noteText noteUpdatedAt")
      .lean();

    const notes = friends
      .filter((friend) => {
        const friendId = toIdString(friend._id);
        if (!friendId) return false;
        if (blockedByCurrent.has(friendId)) return false;
        if (hasUserId(friend.blockedUsers, currentUserId)) return false;
        return isActiveNote(friend.noteText, friend.noteUpdatedAt, nowMs);
      })
      .map((friend) => ({
        userId: toIdString(friend._id),
        name: friend.name || "User",
        avatarUrl: friend.avatarUrl || "",
        text: String(friend.noteText || "").trim(),
        updatedAt: friend.noteUpdatedAt,
      }))
      .sort((a, b) => {
        const left = new Date(a.updatedAt).getTime();
        const right = new Date(b.updatedAt).getTime();
        return right - left;
      });

    const hasMyNote = isActiveNote(req.user.noteText, req.user.noteUpdatedAt, nowMs);
    const myNote = hasMyNote
      ? {
          text: String(req.user.noteText || "").trim(),
          updatedAt: req.user.noteUpdatedAt,
        }
      : null;

    return res.status(200).json({ notes, myNote });
  } catch (error) {
    return next(error);
  }
};

// PUT /api/messages/notes/me — create or update my note
const upsertMyNote = async (req, res, next) => {
  try {
    const rawText = String(req.body?.text || "").trim();
    if (!rawText) {
      throw createHttpError(400, "Note text is required");
    }
    if (rawText.length > MAX_NOTE_LENGTH) {
      throw createHttpError(400, `Note must be ${MAX_NOTE_LENGTH} characters or less`);
    }

    req.user.noteText = rawText;
    req.user.noteUpdatedAt = new Date();
    await req.user.save();

    return res.status(200).json({
      note: {
        text: req.user.noteText,
        updatedAt: req.user.noteUpdatedAt,
      },
    });
  } catch (error) {
    return next(error);
  }
};

// DELETE /api/messages/notes/me — clear my note
const clearMyNote = async (req, res, next) => {
  try {
    req.user.noteText = "";
    req.user.noteUpdatedAt = null;
    await req.user.save();
    return res.status(200).json({ ok: true });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  acceptRequest,
  blockRequestSender,
  deleteRequest,
  getConversations,
  getMessages,
  getRequests,
  getFriendNotes,
  upsertMyNote,
  clearMyNote,
  sendMessage,
};
