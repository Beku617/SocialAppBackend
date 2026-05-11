const AdminAuditLog = require("../models/AdminAuditLog");

const MAX_METADATA_LENGTH = 4000;

const sanitizeMetadata = (metadata = {}) => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  const nextMetadata = {};

  Object.entries(metadata).forEach(([key, value]) => {
    if (value === undefined) {
      return;
    }

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      nextMetadata[key] =
        typeof value === "string" ? value.slice(0, 500) : value;
      return;
    }

    if (Array.isArray(value)) {
      nextMetadata[key] = value.slice(0, 50);
      return;
    }

    if (typeof value === "object") {
      nextMetadata[key] = value;
    }
  });

  const serialized = JSON.stringify(nextMetadata);
  if (serialized.length <= MAX_METADATA_LENGTH) {
    return nextMetadata;
  }

  return {
    summary: serialized.slice(0, MAX_METADATA_LENGTH),
    truncated: true,
  };
};

const createAdminAuditLog = async ({
  adminUserId,
  actionType,
  targetType,
  targetId = "",
  metadata = {},
}) => {
  if (!adminUserId || !actionType || !targetType) {
    return null;
  }

  return AdminAuditLog.create({
    adminUser: adminUserId,
    actionType,
    targetType,
    targetId: typeof targetId === "string" ? targetId.slice(0, 120) : "",
    metadata: sanitizeMetadata(metadata),
  });
};

const mapAdminAuditLog = (entry) => ({
  id:
    entry?._id?.toString?.() || entry?.id?.toString?.() || "",
  actionType: entry.actionType,
  targetType: entry.targetType,
  targetId: entry.targetId || "",
  metadata: entry.metadata || {},
  createdAt: entry.createdAt,
  adminUser: entry.adminUser
    ? {
        id: entry.adminUser._id.toString(),
        name: entry.adminUser.name,
        email: entry.adminUser.email,
      }
    : null,
});

module.exports = {
  createAdminAuditLog,
  mapAdminAuditLog,
};
