const FriendRequest = require("../models/FriendRequest");
const User = require("../models/User");
const { createHttpError } = require("../utils/httpError");
const {
  deleteNotifications,
  replaceNotification,
} = require("../utils/notifications");
const {
  buildFriendshipStatusMap,
  getFriendshipStatus,
  mapUserPreview,
  normalizeId,
} = require("../utils/friendships");
const { isAdminUser } = require("../utils/admin");
const { isUserActive } = require("../utils/userAccountStatus");

const buildPairKey = (firstUserId, secondUserId) =>
  [normalizeId(firstUserId), normalizeId(secondUserId)].sort().join(":");

const loadCurrentAndTargetUsers = async (currentUserId, targetUserId) => {
  const [currentUser, targetUser] = await Promise.all([
    User.findById(currentUserId),
    User.findById(targetUserId),
  ]);

  if (!currentUser) {
    throw createHttpError(401, "Unauthorized");
  }

  if (!targetUser) {
    throw createHttpError(404, "User not found");
  }

  if (!isUserActive(targetUser) || isAdminUser(targetUser)) {
    throw createHttpError(404, "User not found");
  }

  return { currentUser, targetUser };
};

const mapFriendRequest = (request, currentUserId) => {
  const normalizedCurrentUserId = normalizeId(currentUserId);
  const requesterId = normalizeId(request.requester);
  const recipientId = normalizeId(request.recipient);
  const isOutgoing = requesterId === normalizedCurrentUserId;

  return {
    id: request._id.toString(),
    status: request.status,
    createdAt: request.createdAt,
    respondedAt: request.respondedAt,
    requester: mapUserPreview(request.requester),
    recipient: mapUserPreview(request.recipient),
    otherUser: mapUserPreview(isOutgoing ? request.recipient : request.requester, {
      state: isOutgoing ? "outgoing_request" : "incoming_request",
      requestId: request._id.toString(),
    }),
  };
};

const buildFriendshipPayload = async (currentUser, targetUserId) => ({
  friendshipStatus: await getFriendshipStatus(currentUser, targetUserId),
});

const sendFriendRequest = async (req, res, next) => {
  try {
    const currentUserId = req.user._id;
    const targetUserId = req.params.userId;

    if (normalizeId(currentUserId) === normalizeId(targetUserId)) {
      throw createHttpError(400, "Cannot send a friend request to yourself");
    }

    const { currentUser, targetUser } = await loadCurrentAndTargetUsers(
      currentUserId,
      targetUserId,
    );

    if ((currentUser.friends || []).some((id) => normalizeId(id) === normalizeId(targetUserId))) {
      throw createHttpError(409, "You are already friends with this user");
    }

    const existingPendingRequest = await FriendRequest.findOne({
      status: "pending",
      pairKey: buildPairKey(currentUserId, targetUserId),
    });

    if (existingPendingRequest) {
      const isOutgoing =
        normalizeId(existingPendingRequest.requester) === normalizeId(currentUserId);
      throw createHttpError(
        409,
        isOutgoing
          ? "Friend request already sent"
          : "This user already sent you a friend request",
      );
    }

    const request = await FriendRequest.create({
      requester: currentUser._id,
      recipient: targetUser._id,
      status: "pending",
    });

    await replaceNotification({
      filter: {
        recipient: targetUser._id,
        actor: currentUser._id,
        type: "friend_request",
      },
      recipientId: targetUser._id,
      actor: currentUser,
      type: "friend_request",
      message: "sent you a friend request.",
      referenceId: request._id.toString(),
      deepLink: "/(dashboard)/friends",
      push: {
        eventType: "friend_request",
        title: `${currentUser.name} sent you a friend request`,
        body: "Open Friends to review the request.",
        data: {
          targetUserId: targetUser._id.toString(),
        },
      },
    });

    return res.status(201).json({
      request: mapFriendRequest(
        {
          ...request.toObject(),
          requester: currentUser,
          recipient: targetUser,
        },
        currentUser._id,
      ),
      friendshipStatus: {
        state: "outgoing_request",
        requestId: request._id.toString(),
      },
      friendsCount: targetUser.friends?.length || 0,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return next(createHttpError(409, "Friend request already exists"));
    }
    return next(error);
  }
};

const cancelFriendRequest = async (req, res, next) => {
  try {
    const request = await FriendRequest.findOne({
      requester: req.user._id,
      recipient: req.params.userId,
      status: "pending",
    });

    if (!request) {
      throw createHttpError(404, "Pending friend request not found");
    }

    request.status = "canceled";
    request.respondedAt = new Date();
    await request.save();

    await deleteNotifications({
      recipient: req.params.userId,
      actor: req.user._id,
      type: "friend_request",
    });

    return res.status(200).json({
      message: "Friend request canceled",
      friendshipStatus: {
        state: "no_relationship",
        requestId: null,
      },
    });
  } catch (error) {
    return next(error);
  }
};

const acceptFriendRequest = async (req, res, next) => {
  try {
    const currentUserId = req.user._id;
    const targetUserId = req.params.userId;

    const request = await FriendRequest.findOneAndUpdate(
      {
        requester: targetUserId,
        recipient: currentUserId,
        status: "pending",
      },
      {
        $set: {
          status: "accepted",
          respondedAt: new Date(),
        },
      },
      {
        new: true,
      },
    ).populate("requester recipient", "name avatarUrl bio");

    if (!request) {
      throw createHttpError(404, "Friend request not found");
    }

    const { currentUser, targetUser } = await loadCurrentAndTargetUsers(
      currentUserId,
      targetUserId,
    );

    await Promise.all([
      User.updateOne(
        { _id: currentUser._id },
        { $addToSet: { friends: targetUser._id } },
      ),
      User.updateOne(
        { _id: targetUser._id },
        { $addToSet: { friends: currentUser._id } },
      ),
    ]);

    const refreshedTargetUser = await User.findById(targetUser._id).select(
      "name avatarUrl bio friends",
    );

    await deleteNotifications({
      recipient: currentUser._id,
      actor: targetUser._id,
      type: "friend_request",
    });

    await replaceNotification({
      filter: {
        recipient: targetUser._id,
        actor: currentUser._id,
        type: "friend_accept",
      },
      recipientId: targetUser._id,
      actor: currentUser,
      type: "friend_accept",
      message: "accepted your friend request.",
      referenceId: currentUser._id.toString(),
      deepLink: `/users/${currentUser._id.toString()}`,
      push: {
        eventType: "friend_accept",
        title: `${currentUser.name} accepted your friend request`,
        body: "Tap to view their profile.",
        data: {
          targetUserId: currentUser._id.toString(),
        },
      },
    });

    return res.status(200).json({
      request: mapFriendRequest(
        {
          ...request.toObject(),
          requester: targetUser,
          recipient: currentUser,
        },
        currentUser._id,
      ),
      friendshipStatus: {
        state: "friends",
        requestId: null,
      },
      friendsCount: refreshedTargetUser?.friends?.length || 0,
    });
  } catch (error) {
    return next(error);
  }
};

const declineFriendRequest = async (req, res, next) => {
  try {
    const request = await FriendRequest.findOne({
      requester: req.params.userId,
      recipient: req.user._id,
      status: "pending",
    });

    if (!request) {
      throw createHttpError(404, "Friend request not found");
    }

    request.status = "declined";
    request.respondedAt = new Date();
    await request.save();

    await deleteNotifications({
      recipient: req.user._id,
      actor: req.params.userId,
      type: "friend_request",
    });

    return res.status(200).json({
      message: "Friend request declined",
      friendshipStatus: {
        state: "no_relationship",
        requestId: null,
      },
    });
  } catch (error) {
    return next(error);
  }
};

const unfriendUser = async (req, res, next) => {
  try {
    const currentUserId = req.user._id;
    const targetUserId = req.params.userId;
    const { currentUser, targetUser } = await loadCurrentAndTargetUsers(
      currentUserId,
      targetUserId,
    );

    const wasFriends = (currentUser.friends || []).some(
      (id) => normalizeId(id) === normalizeId(targetUserId),
    );

    if (!wasFriends) {
      throw createHttpError(404, "You are not friends with this user");
    }

    await Promise.all([
      User.updateOne({ _id: currentUser._id }, { $pull: { friends: targetUser._id } }),
      User.updateOne({ _id: targetUser._id }, { $pull: { friends: currentUser._id } }),
    ]);

    const refreshedTargetUser = await User.findById(targetUser._id).select("friends");

    return res.status(200).json({
      message: "Friend removed",
      friendshipStatus: {
        state: "no_relationship",
        requestId: null,
      },
      friendsCount: refreshedTargetUser?.friends?.length || 0,
    });
  } catch (error) {
    return next(error);
  }
};

const listFriends = async (req, res, next) => {
  try {
    const currentUser = await User.findById(req.user._id);
    const populatedCurrentUser = await User.findById(req.user._id).populate(
      "friends",
      "name avatarUrl bio",
    );

    if (!currentUser || !populatedCurrentUser) {
      throw createHttpError(401, "Unauthorized");
    }

    const friends = populatedCurrentUser.friends || [];
    const statusMap = await buildFriendshipStatusMap(currentUser, friends.map((user) => user._id));

    return res.status(200).json({
      users: friends.map((user) =>
        mapUserPreview(user, statusMap[normalizeId(user._id)]),
      ),
      count: friends.length,
    });
  } catch (error) {
    return next(error);
  }
};

const listUserFriends = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.userId).populate(
      "friends",
      "name avatarUrl bio",
    );

    if (!user) {
      throw createHttpError(404, "User not found");
    }
    if (!isUserActive(user) || isAdminUser(user)) {
      throw createHttpError(404, "User not found");
    }

    const statusMap = await buildFriendshipStatusMap(
      req.user,
      (user.friends || []).map((friend) => friend._id),
    );

    return res.status(200).json({
      users: (user.friends || []).map((friend) =>
        mapUserPreview(friend, statusMap[normalizeId(friend._id)]),
      ),
      count: user.friends?.length || 0,
    });
  } catch (error) {
    return next(error);
  }
};

const listIncomingFriendRequests = async (req, res, next) => {
  try {
    const requests = await FriendRequest.find({
      recipient: req.user._id,
      status: "pending",
    })
      .sort({ createdAt: -1 })
      .populate("requester recipient", "name avatarUrl bio");

    return res.status(200).json({
      requests: requests.map((request) => mapFriendRequest(request, req.user._id)),
      count: requests.length,
    });
  } catch (error) {
    return next(error);
  }
};

const listOutgoingFriendRequests = async (req, res, next) => {
  try {
    const requests = await FriendRequest.find({
      requester: req.user._id,
      status: "pending",
    })
      .sort({ createdAt: -1 })
      .populate("requester recipient", "name avatarUrl bio");

    return res.status(200).json({
      requests: requests.map((request) => mapFriendRequest(request, req.user._id)),
      count: requests.length,
    });
  } catch (error) {
    return next(error);
  }
};

const getFriendshipStatusController = async (req, res, next) => {
  try {
    return res.status(200).json(
      await buildFriendshipPayload(req.user, req.params.userId),
    );
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  getFriendshipStatusController,
  listFriends,
  listIncomingFriendRequests,
  listOutgoingFriendRequests,
  listUserFriends,
  sendFriendRequest,
  unfriendUser,
};
