const Notification = require("../models/Notification");
const { sendPushToUser } = require("./pushNotifications");

const toIdString = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value._id) return value._id.toString();
  return value.toString();
};

const buildActorSnapshot = (actor) => ({
  actor: actor?._id || actor?.id || null,
  actorName: actor?.name || "",
  actorAvatarUrl: actor?.avatarUrl || "",
});

const buildPushData = ({
  type,
  actor,
  postId = null,
  reelId = null,
  referenceId = "",
  deepLink = "",
  data = {},
}) => ({
  type,
  actorId: toIdString(actor),
  actorName: actor?.name || "",
  actorAvatarUrl: actor?.avatarUrl || "",
  postId: postId ? toIdString(postId) : "",
  reelId: reelId ? toIdString(reelId) : "",
  referenceId: referenceId || "",
  deepLink: deepLink || "",
  ...data,
});

const dispatchPushForNotification = async ({
  notification,
  actor,
  type,
  postId = null,
  reelId = null,
  referenceId = "",
  deepLink = "",
  push = null,
}) => {
  if (!notification || !push?.eventType || !push?.title || !push?.body) {
    return;
  }

  try {
    await sendPushToUser({
      userId: notification.recipient,
      eventType: push.eventType,
      title: push.title,
      body: push.body,
      data: buildPushData({
        type,
        actor,
        postId,
        reelId,
        referenceId,
        deepLink,
        data: push.data || {},
      }),
    });
  } catch (error) {
    console.error(
      "[push] Failed to deliver notification push:",
      error?.message || error,
    );
  }
};

const createNotification = async ({
  recipientId,
  actor,
  type,
  title = "",
  message,
  postId = null,
  reelId = null,
  referenceId = "",
  category = "activity",
  deepLink = "",
  push = null,
}) => {
  const normalizedRecipientId = toIdString(recipientId);
  const normalizedActorId = toIdString(actor);

  if (
    !normalizedRecipientId ||
    !normalizedActorId ||
    normalizedRecipientId === normalizedActorId
  ) {
    return null;
  }

  const notification = await Notification.create({
    recipient: normalizedRecipientId,
    ...buildActorSnapshot(actor),
    type,
    title,
    post: postId || null,
    reel: reelId || null,
    referenceId: referenceId || "",
    message,
    category,
    deepLink,
  });

  void dispatchPushForNotification({
    notification,
    actor,
    type,
    postId,
    reelId,
    referenceId,
    deepLink,
    push,
  });

  return notification;
};

const replaceNotification = async ({
  filter,
  recipientId,
  actor,
  type,
  title = "",
  message,
  postId = null,
  reelId = null,
  referenceId = "",
  category = "activity",
  deepLink = "",
  push = null,
}) => {
  await Notification.deleteMany(filter);
  return createNotification({
    recipientId,
    actor,
    type,
    title,
    message,
    postId,
    reelId,
    referenceId,
    category,
    deepLink,
    push,
  });
};

const deleteNotifications = async (filter) => Notification.deleteMany(filter);

module.exports = {
  createNotification,
  replaceNotification,
  deleteNotifications,
  toIdString,
};
