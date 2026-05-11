const crypto = require("crypto");
const AdminNotificationCampaign = require("../models/AdminNotificationCampaign");
const Notification = require("../models/Notification");
const User = require("../models/User");
const { createAdminAuditLog } = require("./adminAudit");
const { sendPushToUser } = require("./pushNotifications");
const { buildActiveAccountQuery } = require("./userAccountStatus");

const INLINE_PROCESSING_LIMIT = 25;
const NOTIFICATION_BATCH_SIZE = 100;
const PUSH_BATCH_SIZE = 10;
const DUPLICATE_WINDOW_MS = 90 * 1000;

let queueDrainScheduled = false;
let queueDrainPromise = null;

const toIdString = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value._id) return value._id.toString();
  return value.toString();
};

const createHash = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex");

const chunkArray = (values = [], size = 1) => {
  const chunks = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
};

const normalizeUserIds = (userIds = []) => {
  const seen = new Set();
  const normalized = [];

  (Array.isArray(userIds) ? userIds : []).forEach((value) => {
    const nextValue = toIdString(value).trim();
    if (!nextValue || seen.has(nextValue)) {
      return;
    }

    seen.add(nextValue);
    normalized.push(nextValue);
  });

  return normalized;
};

const mapCampaign = (campaign) => ({
  id: toIdString(campaign?._id || campaign?.id),
  audienceType: campaign?.audienceType || "selected",
  title: campaign?.title || "",
  body: campaign?.body || "",
  category: campaign?.category || "announcement",
  deepLink: campaign?.deepLink || "",
  status: campaign?.status || "queued",
  processingMode: campaign?.processingMode || "immediate",
  recipientCount: Number(campaign?.recipientCount || 0),
  requestedRecipientCount: Number(campaign?.requestedRecipientCount || 0),
  skippedRecipientCount: Number(campaign?.skippedRecipientCount || 0),
  invalidRecipientCount: Number(campaign?.invalidRecipientCount || 0),
  inAppCreatedCount: Number(
    campaign?.inAppCreatedCount ?? campaign?.recipientCount ?? 0,
  ),
  failedRecipientCount: Number(campaign?.failedRecipientCount || 0),
  pushRequested: Boolean(campaign?.pushRequested),
  pushAttemptedCount: Number(campaign?.pushAttemptedCount || 0),
  pushDeliveredCount: Number(campaign?.pushDeliveredCount || 0),
  pushSkippedCount: Number(campaign?.pushSkippedCount || 0),
  pushFailedCount: Number(campaign?.pushFailedCount || 0),
  clientRequestId: campaign?.clientRequestId || "",
  lastError: campaign?.lastError || "",
  startedAt: campaign?.startedAt || null,
  completedAt: campaign?.completedAt || null,
  createdAt: campaign?.createdAt || null,
  updatedAt: campaign?.updatedAt || null,
  sender: campaign?.sender
    ? {
        id: toIdString(campaign.sender),
        name: campaign.sender.name || "",
        email: campaign.sender.email || "",
      }
    : null,
});

const getCampaignActionName = (campaignOrAudienceType, phase = "requested") => {
  const audienceType =
    typeof campaignOrAudienceType === "string"
      ? campaignOrAudienceType
      : campaignOrAudienceType?.audienceType;

  switch (audienceType) {
    case "single":
      return `notification_send_single_${phase}`;
    case "all":
      return `notification_send_all_${phase}`;
    default:
      return `notification_send_bulk_${phase}`;
  }
};

const hydrateCampaign = async (campaignId, { includeRecipients = false } = {}) => {
  const query = AdminNotificationCampaign.findById(campaignId).populate(
    "sender",
    "name email avatarUrl role",
  );

  if (includeRecipients) {
    query.select("+recipientIds");
  }

  return query;
};

const buildPayloadHash = ({
  senderId,
  audienceType,
  recipientIds,
  title,
  body,
  category,
  deepLink,
  sendPush,
}) =>
  createHash(
    JSON.stringify({
      senderId,
      audienceType,
      recipientIds: normalizeUserIds(recipientIds).sort(),
      title,
      body,
      category,
      deepLink,
      sendPush: Boolean(sendPush),
    }),
  );

const buildIdempotencyKey = ({ senderId, clientRequestId }) => {
  const normalizedRequestId =
    typeof clientRequestId === "string" ? clientRequestId.trim() : "";

  if (!normalizedRequestId) {
    return undefined;
  }

  return createHash(`${senderId}:${normalizedRequestId}`);
};

const resolveCampaignRecipients = async ({ audienceType, targetUserIds = [] }) => {
  if (audienceType === "all") {
    const users = await User.find({
      role: "user",
      ...buildActiveAccountQuery(),
    })
      .select("_id")
      .lean();

    const recipientIds = users.map((user) => user._id.toString());

    return {
      recipientIds,
      requestedRecipientCount: recipientIds.length,
      invalidRecipientCount: 0,
      skippedRecipientCount: 0,
    };
  }

  const requestedIds = normalizeUserIds(targetUserIds);
  if (!requestedIds.length) {
    return {
      recipientIds: [],
      requestedRecipientCount: 0,
      invalidRecipientCount: 0,
      skippedRecipientCount: 0,
    };
  }

  const activeUsers = await User.find({
    _id: { $in: requestedIds },
    role: "user",
    ...buildActiveAccountQuery(),
  })
    .select("_id")
    .lean();

  const activeIdSet = new Set(activeUsers.map((user) => user._id.toString()));
  const recipientIds = requestedIds.filter((userId) => activeIdSet.has(userId));

  return {
    recipientIds,
    requestedRecipientCount: requestedIds.length,
    invalidRecipientCount: requestedIds.length - recipientIds.length,
    skippedRecipientCount: 0,
  };
};

const findExistingIdempotentCampaign = async ({ idempotencyKey, payloadHash, senderId }) => {
  if (idempotencyKey) {
    const existingCampaign = await AdminNotificationCampaign.findOne({
      idempotencyKey,
    }).populate("sender", "name email avatarUrl role");

    if (existingCampaign) {
      return existingCampaign;
    }
  }

  if (!payloadHash) {
    return null;
  }

  return AdminNotificationCampaign.findOne({
    sender: senderId,
    payloadHash,
    createdAt: { $gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
    status: { $in: ["queued", "processing", "completed", "completed_with_errors"] },
  })
    .sort({ createdAt: -1 })
    .populate("sender", "name email avatarUrl role");
};

const upsertInAppNotifications = async ({ campaign, recipientIds }) => {
  if (!recipientIds.length) {
    return { deliveredCount: 0, failedCount: 0, errorMessage: "" };
  }

  const senderId = toIdString(campaign.sender);
  const senderName = campaign.sender?.name || "";
  const senderAvatarUrl = campaign.sender?.avatarUrl || "";
  const now = new Date();

  const operations = recipientIds.map((recipientId) => ({
    updateOne: {
      filter: {
        recipient: recipientId,
        type: "admin_message",
        referenceId: campaign._id.toString(),
      },
      update: {
        $setOnInsert: {
          recipient: recipientId,
          actor: senderId || null,
          actorName: senderName,
          actorAvatarUrl: senderAvatarUrl,
          type: "admin_message",
          title: campaign.title,
          message: campaign.body,
          category: campaign.category || "announcement",
          deepLink: campaign.deepLink || "",
          referenceId: campaign._id.toString(),
          isRead: false,
          createdAt: now,
          updatedAt: now,
        },
        $set: {
          updatedAt: now,
        },
      },
      upsert: true,
    },
  }));

  try {
    await Notification.bulkWrite(operations, { ordered: false });
    return {
      deliveredCount: recipientIds.length,
      failedCount: 0,
      errorMessage: "",
    };
  } catch (error) {
    return {
      deliveredCount: 0,
      failedCount: recipientIds.length,
      errorMessage: error?.message || "Failed to create in-app notifications",
    };
  }
};

const sendOptionalPushBatch = async ({ campaign, recipientIds }) => {
  if (!campaign.pushRequested || !recipientIds.length) {
    return {
      attemptedCount: 0,
      deliveredCount: 0,
      skippedCount: 0,
      failedCount: 0,
      errorMessage: "",
    };
  }

  const pushTotals = {
    attemptedCount: 0,
    deliveredCount: 0,
    skippedCount: 0,
    failedCount: 0,
    errorMessage: "",
  };

  const pushChunks = chunkArray(recipientIds, PUSH_BATCH_SIZE);

  for (const pushChunk of pushChunks) {
    const results = await Promise.allSettled(
      pushChunk.map((recipientId) =>
        sendPushToUser({
          userId: recipientId,
          eventType: "admin_message",
          title: campaign.title,
          body: campaign.body,
          data: {
            type: "admin_message",
            actorId: toIdString(campaign.sender),
            actorName: campaign.sender?.name || "",
            actorAvatarUrl: campaign.sender?.avatarUrl || "",
            category: campaign.category || "announcement",
            deepLink: campaign.deepLink || "",
            campaignId: campaign._id.toString(),
          },
        }),
      ),
    );

    results.forEach((result) => {
      if (result.status === "rejected") {
        pushTotals.attemptedCount += 1;
        pushTotals.failedCount += 1;
        if (!pushTotals.errorMessage) {
          pushTotals.errorMessage =
            result.reason?.message || "Push delivery failed";
        }
        return;
      }

      if (result.value?.skipped) {
        pushTotals.skippedCount += 1;
        return;
      }

      pushTotals.attemptedCount += 1;
      pushTotals.deliveredCount += Number(result.value?.delivered || 0);
    });
  }

  return pushTotals;
};

const finalizeCampaignStatus = (campaign, totals) => {
  if (!campaign) {
    return "failed";
  }

  if (totals.failedRecipientCount > 0 || totals.pushFailedCount > 0) {
    return "completed_with_errors";
  }

  if (
    totals.skippedRecipientCount >
    Number(campaign.skippedRecipientCount || 0)
  ) {
    return "completed_with_errors";
  }

  return "completed";
};

const processAdminNotificationCampaign = async (campaignId) => {
  const claimedCampaign = await AdminNotificationCampaign.findOneAndUpdate(
    { _id: campaignId, status: "queued" },
    {
      $set: {
        status: "processing",
        startedAt: new Date(),
        completedAt: null,
        lastError: "",
        inAppCreatedCount: 0,
        failedRecipientCount: 0,
        pushAttemptedCount: 0,
        pushDeliveredCount: 0,
        pushSkippedCount: 0,
        pushFailedCount: 0,
      },
    },
    { new: true },
  )
    .select("+recipientIds")
    .populate("sender", "name email avatarUrl role");

  if (!claimedCampaign) {
    return hydrateCampaign(campaignId);
  }

  const recipientIds = normalizeUserIds(claimedCampaign.recipientIds || []);
  const batchTotals = {
    skippedRecipientCount: Number(claimedCampaign.skippedRecipientCount || 0),
    invalidRecipientCount: Number(claimedCampaign.invalidRecipientCount || 0),
    inAppCreatedCount: 0,
    failedRecipientCount: 0,
    pushAttemptedCount: 0,
    pushDeliveredCount: 0,
    pushSkippedCount: 0,
    pushFailedCount: 0,
    lastError: "",
  };

  for (const batch of chunkArray(recipientIds, NOTIFICATION_BATCH_SIZE)) {
    const eligibleUsers = await User.find({
      _id: { $in: batch },
      role: "user",
      ...buildActiveAccountQuery(),
    })
      .select("_id")
      .lean();

    const eligibleIds = eligibleUsers.map((user) => user._id.toString());
    const skippedThisBatch = batch.length - eligibleIds.length;

    if (skippedThisBatch > 0) {
      batchTotals.skippedRecipientCount += skippedThisBatch;
    }

    if (eligibleIds.length) {
      const inAppResult = await upsertInAppNotifications({
        campaign: claimedCampaign,
        recipientIds: eligibleIds,
      });

      batchTotals.inAppCreatedCount += inAppResult.deliveredCount;
      batchTotals.failedRecipientCount += inAppResult.failedCount;

      if (!batchTotals.lastError && inAppResult.errorMessage) {
        batchTotals.lastError = inAppResult.errorMessage;
      }

      if (inAppResult.failedCount === 0) {
        const pushResult = await sendOptionalPushBatch({
          campaign: claimedCampaign,
          recipientIds: eligibleIds,
        });

        batchTotals.pushAttemptedCount += pushResult.attemptedCount;
        batchTotals.pushDeliveredCount += pushResult.deliveredCount;
        batchTotals.pushSkippedCount += pushResult.skippedCount;
        batchTotals.pushFailedCount += pushResult.failedCount;

        if (!batchTotals.lastError && pushResult.errorMessage) {
          batchTotals.lastError = pushResult.errorMessage;
        }
      }
    }

    await AdminNotificationCampaign.updateOne(
      { _id: claimedCampaign._id },
      {
        $set: {
          skippedRecipientCount: batchTotals.skippedRecipientCount,
          invalidRecipientCount: batchTotals.invalidRecipientCount,
          inAppCreatedCount: batchTotals.inAppCreatedCount,
          failedRecipientCount: batchTotals.failedRecipientCount,
          pushAttemptedCount: batchTotals.pushAttemptedCount,
          pushDeliveredCount: batchTotals.pushDeliveredCount,
          pushSkippedCount: batchTotals.pushSkippedCount,
          pushFailedCount: batchTotals.pushFailedCount,
          lastError: batchTotals.lastError,
        },
      },
    );
  }

  const finalStatus = finalizeCampaignStatus(claimedCampaign, batchTotals);
  const completedAt = new Date();

  await AdminNotificationCampaign.updateOne(
    { _id: claimedCampaign._id },
    {
      $set: {
        status: finalStatus,
        completedAt,
        skippedRecipientCount: batchTotals.skippedRecipientCount,
        invalidRecipientCount: batchTotals.invalidRecipientCount,
        inAppCreatedCount: batchTotals.inAppCreatedCount,
        failedRecipientCount: batchTotals.failedRecipientCount,
        pushAttemptedCount: batchTotals.pushAttemptedCount,
        pushDeliveredCount: batchTotals.pushDeliveredCount,
        pushSkippedCount: batchTotals.pushSkippedCount,
        pushFailedCount: batchTotals.pushFailedCount,
        lastError: batchTotals.lastError,
      },
    },
  );

  await createAdminAuditLog({
    adminUserId: toIdString(claimedCampaign.sender),
    actionType: getCampaignActionName(claimedCampaign, finalStatus === "completed" ? "completed" : "completed_with_errors"),
    targetType: "admin_notification_campaign",
    targetId: claimedCampaign._id.toString(),
    metadata: {
      title: claimedCampaign.title,
      category: claimedCampaign.category,
      audienceType: claimedCampaign.audienceType,
      requestedRecipientCount: claimedCampaign.requestedRecipientCount,
      recipientCount: claimedCampaign.recipientCount,
      inAppCreatedCount: batchTotals.inAppCreatedCount,
      failedRecipientCount: batchTotals.failedRecipientCount,
      pushRequested: claimedCampaign.pushRequested,
      pushAttemptedCount: batchTotals.pushAttemptedCount,
      pushDeliveredCount: batchTotals.pushDeliveredCount,
      pushSkippedCount: batchTotals.pushSkippedCount,
      pushFailedCount: batchTotals.pushFailedCount,
      status: finalStatus,
      lastError: batchTotals.lastError || undefined,
    },
  });

  return hydrateCampaign(claimedCampaign._id);
};

const drainAdminNotificationCampaignQueue = async () => {
  if (queueDrainPromise) {
    return queueDrainPromise;
  }

  queueDrainPromise = (async () => {
    try {
      while (true) {
        const nextCampaign = await AdminNotificationCampaign.findOne({
          status: "queued",
          processingMode: "batched",
        })
          .sort({ createdAt: 1 })
          .select("_id");

        if (!nextCampaign) {
          break;
        }

        try {
          await processAdminNotificationCampaign(nextCampaign._id);
        } catch (error) {
          console.error(
            "[adminNotifications] Failed to process campaign",
            nextCampaign._id.toString(),
            error?.message || error,
          );

          await AdminNotificationCampaign.updateOne(
            { _id: nextCampaign._id },
            {
              $set: {
                status: "failed",
                completedAt: new Date(),
                lastError: error?.message || "Campaign processing failed",
              },
            },
          );
        }
      }
    } finally {
      queueDrainPromise = null;
    }
  })();

  return queueDrainPromise;
};

const scheduleAdminNotificationCampaignProcessing = () => {
  if (queueDrainScheduled) {
    return;
  }

  queueDrainScheduled = true;

  setTimeout(() => {
    queueDrainScheduled = false;
    void drainAdminNotificationCampaignQueue();
  }, 0);
};

const createAdminNotifications = async ({
  sender,
  audienceType,
  targetUserIds = [],
  title,
  body,
  category = "announcement",
  deepLink = "",
  sendPush = false,
  clientRequestId = "",
}) => {
  const senderId = toIdString(sender);
  const resolvedRecipients = await resolveCampaignRecipients({
    audienceType,
    targetUserIds,
  });

  if (!resolvedRecipients.recipientIds.length) {
    return {
      campaign: null,
      deduplicated: false,
      queued: false,
      requestedRecipientCount: resolvedRecipients.requestedRecipientCount,
      recipientCount: 0,
      skippedRecipientCount: resolvedRecipients.skippedRecipientCount,
      invalidRecipientCount: resolvedRecipients.invalidRecipientCount,
      inAppCreatedCount: 0,
      failedRecipientCount: 0,
      pushAttemptedCount: 0,
      pushDeliveredCount: 0,
      pushSkippedCount: 0,
      pushFailedCount: 0,
    };
  }

  const normalizedTitle = title.trim();
  const normalizedBody = body.trim();
  const normalizedCategory = typeof category === "string" ? category.trim() : "announcement";
  const normalizedDeepLink = typeof deepLink === "string" ? deepLink.trim() : "";
  const normalizedClientRequestId =
    typeof clientRequestId === "string" ? clientRequestId.trim() : "";
  const idempotencyKey = buildIdempotencyKey({
    senderId,
    clientRequestId: normalizedClientRequestId,
  });
  const payloadHash = buildPayloadHash({
    senderId,
    audienceType,
    recipientIds: resolvedRecipients.recipientIds,
    title: normalizedTitle,
    body: normalizedBody,
    category: normalizedCategory,
    deepLink: normalizedDeepLink,
    sendPush,
  });

  const canDeduplicateByPayload =
    audienceType === "all" || resolvedRecipients.recipientIds.length > 1;
  const existingCampaign = await findExistingIdempotentCampaign({
    idempotencyKey,
    payloadHash: canDeduplicateByPayload ? payloadHash : "",
    senderId,
  });

  if (existingCampaign) {
    return {
      campaign: existingCampaign,
      deduplicated: true,
      queued: ["queued", "processing"].includes(existingCampaign.status),
      requestedRecipientCount: existingCampaign.requestedRecipientCount,
      recipientCount: existingCampaign.recipientCount,
      skippedRecipientCount: existingCampaign.skippedRecipientCount,
      invalidRecipientCount: existingCampaign.invalidRecipientCount,
      inAppCreatedCount:
        existingCampaign.inAppCreatedCount ?? existingCampaign.recipientCount,
      failedRecipientCount: existingCampaign.failedRecipientCount || 0,
      pushAttemptedCount: existingCampaign.pushAttemptedCount || 0,
      pushDeliveredCount: existingCampaign.pushDeliveredCount || 0,
      pushSkippedCount: existingCampaign.pushSkippedCount || 0,
      pushFailedCount: existingCampaign.pushFailedCount || 0,
    };
  }

  const processingMode =
    audienceType === "single" ||
    resolvedRecipients.recipientIds.length <= INLINE_PROCESSING_LIMIT
      ? "immediate"
      : "batched";

  const campaign = await AdminNotificationCampaign.create({
    sender: senderId,
    audienceType,
    title: normalizedTitle,
    body: normalizedBody,
    category: normalizedCategory || "announcement",
    deepLink: normalizedDeepLink,
    status: "queued",
    processingMode,
    recipientIds: resolvedRecipients.recipientIds,
    recipientCount: resolvedRecipients.recipientIds.length,
    requestedRecipientCount: resolvedRecipients.requestedRecipientCount,
    skippedRecipientCount: resolvedRecipients.skippedRecipientCount,
    invalidRecipientCount: resolvedRecipients.invalidRecipientCount,
    pushRequested: Boolean(sendPush),
    clientRequestId: normalizedClientRequestId || undefined,
    idempotencyKey,
    payloadHash,
  });

  await createAdminAuditLog({
    adminUserId: senderId,
    actionType: getCampaignActionName(audienceType, "requested"),
    targetType: "admin_notification_campaign",
    targetId: campaign._id.toString(),
    metadata: {
      audienceType,
      title: normalizedTitle,
      category: normalizedCategory || "announcement",
      requestedRecipientCount: resolvedRecipients.requestedRecipientCount,
      recipientCount: resolvedRecipients.recipientIds.length,
      invalidRecipientCount: resolvedRecipients.invalidRecipientCount,
      pushRequested: Boolean(sendPush),
      processingMode,
    },
  });

  if (processingMode === "immediate") {
    const processedCampaign = await processAdminNotificationCampaign(campaign._id);

    return {
      campaign: processedCampaign,
      deduplicated: false,
      queued: false,
      requestedRecipientCount: processedCampaign.requestedRecipientCount,
      recipientCount: processedCampaign.recipientCount,
      skippedRecipientCount: processedCampaign.skippedRecipientCount,
      invalidRecipientCount: processedCampaign.invalidRecipientCount,
      inAppCreatedCount:
        processedCampaign.inAppCreatedCount ?? processedCampaign.recipientCount,
      failedRecipientCount: processedCampaign.failedRecipientCount || 0,
      pushAttemptedCount: processedCampaign.pushAttemptedCount || 0,
      pushDeliveredCount: processedCampaign.pushDeliveredCount || 0,
      pushSkippedCount: processedCampaign.pushSkippedCount || 0,
      pushFailedCount: processedCampaign.pushFailedCount || 0,
    };
  }

  scheduleAdminNotificationCampaignProcessing();

  const queuedCampaign = await hydrateCampaign(campaign._id);

  return {
    campaign: queuedCampaign,
    deduplicated: false,
    queued: true,
    requestedRecipientCount: queuedCampaign.requestedRecipientCount,
    recipientCount: queuedCampaign.recipientCount,
    skippedRecipientCount: queuedCampaign.skippedRecipientCount,
    invalidRecipientCount: queuedCampaign.invalidRecipientCount,
    inAppCreatedCount: queuedCampaign.inAppCreatedCount || 0,
    failedRecipientCount: queuedCampaign.failedRecipientCount || 0,
    pushAttemptedCount: queuedCampaign.pushAttemptedCount || 0,
    pushDeliveredCount: queuedCampaign.pushDeliveredCount || 0,
    pushSkippedCount: queuedCampaign.pushSkippedCount || 0,
    pushFailedCount: queuedCampaign.pushFailedCount || 0,
  };
};

const resumePendingAdminNotificationCampaignProcessing = async () => {
  await AdminNotificationCampaign.updateMany(
    { status: "processing" },
    {
      $set: {
        status: "failed",
        completedAt: new Date(),
        lastError: "Server restarted before campaign processing completed",
      },
    },
  );

  scheduleAdminNotificationCampaignProcessing();
};

module.exports = {
  createAdminNotifications,
  mapCampaign,
  processAdminNotificationCampaign,
  resumePendingAdminNotificationCampaignProcessing,
};
