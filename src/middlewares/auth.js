const jwt = require("jsonwebtoken");
const { env } = require("../config/env");
const User = require("../models/User");
const { ensureUserCanAccess } = require("../utils/userAccess");

const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ message: "Missing bearer token" });
    }

    const payload = jwt.verify(token, env.JWT_SECRET);
    const user = await User.findById(payload.sub);

    if (!user) {
      return res.status(401).json({ message: "Invalid token" });
    }

    await ensureUserCanAccess(user);
    req.user = user;
    return next();
  } catch (error) {
    return res
      .status(error?.statusCode || 401)
      .json({ message: error?.message || "Unauthorized" });
  }
};

const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }

  return next();
};

module.exports = {
  requireAuth,
  requireAdmin,
};
