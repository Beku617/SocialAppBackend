const FriendRequest = require("../models/FriendRequest");

const normalizeId = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value._id) return value._id.toString();
  return value.toString();
};

const buildNoRelationshipStatus = () => ({
  state: "no_relationship",
  requestId: null,
});

const buildFriendshipStatusMap = async (currentUser, userIds) => {
  const currentUserId = normalizeId(currentUser);
  const uniqueIds = [...new Set((userIds || []).map(normalizeId))]
    .filter((id) => id && id !== currentUserId);
  const friendshipStatuses = {};

  if (uniqueIds.length === 0) {
    return friendshipStatuses;
  }

  const friendIds = new Set((currentUser?.friends || []).map(normalizeId));
  uniqueIds.forEach((id) => {
    friendshipStatuses[id] = friendIds.has(id)
      ? { state: "friends", requestId: null }
      : buildNoRelationshipStatus();
  });

  const pendingRequests = await FriendRequest.find({
    status: "pending",
    $or: [
      { requester: currentUserId, recipient: { $in: uniqueIds } },
      { recipient: currentUserId, requester: { $in: uniqueIds } },
    ],
  })
    .select("requester recipient")
    .lean();

  pendingRequests.forEach((request) => {
    const requesterId = normalizeId(request.requester);
    const recipientId = normalizeId(request.recipient);
    const otherUserId = requesterId === currentUserId ? recipientId : requesterId;

    if (!otherUserId || friendIds.has(otherUserId)) {
      return;
    }

    friendshipStatuses[otherUserId] = {
      state:
        requesterId === currentUserId
          ? "outgoing_request"
          : "incoming_request",
      requestId: normalizeId(request._id),
    };
  });

  return friendshipStatuses;
};

const getFriendshipStatus = async (currentUser, targetUserId) => {
  const statusMap = await buildFriendshipStatusMap(currentUser, [targetUserId]);
  return statusMap[normalizeId(targetUserId)] || buildNoRelationshipStatus();
};

const mapUserPreview = (user, friendshipStatus = buildNoRelationshipStatus()) => ({
  id: normalizeId(user),
  name: user?.name || "Unknown user",
  avatarUrl: user?.avatarUrl || "",
  bio: user?.bio || "",
  friendshipStatus,
});

module.exports = {
  buildFriendshipStatusMap,
  buildNoRelationshipStatus,
  getFriendshipStatus,
  mapUserPreview,
  normalizeId,
};
