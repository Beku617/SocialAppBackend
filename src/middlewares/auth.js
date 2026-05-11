const jwt = require("jsonwebtoken");
const { env } = require("../config/env");
const User = require("../models/User");
const { isAdminUser } = require("../utils/admin");
const {
  getUserStatusErrorMessage,
  isUserActive,
} = require("../utils/userAccountStatus");

const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ message: "Missing bearer token" });
    }

    const payload = jwt.verify(token, env.JWT_SECRET);
    if (payload?.type && payload.type !== "access") {
      return res.status(401).json({ message: "Invalid token" });
    }
    const user = await User.findById(payload.sub);

    if (!user) {
      return res.status(401).json({ message: "Invalid token" });
    }

    if (!isUserActive(user)) {
      return res.status(403).json({
        message: getUserStatusErrorMessage(user.accountStatus),
      });
    }

    req.user = user;
    req.isAdmin = isAdminUser(user);
    return next();
  } catch (_error) {
    return res.status(401).json({ message: "Unauthorized" });
  }
};

const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (!req.isAdmin) {
    return res.status(403).json({ message: "Admin access required" });
  }

  return next();
};

module.exports = {
  requireAuth,
  requireAdmin,
};
