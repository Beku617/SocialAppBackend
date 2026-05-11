const jwt = require("jsonwebtoken");
const { env } = require("../config/env");

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

const buildExpiryDate = (ttlSeconds) =>
  new Date(Date.now() + ttlSeconds * 1000);

const createAccessToken = (userId) =>
  jwt.sign({ sub: userId, type: "access" }, env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });

const createRefreshToken = (userId) =>
  jwt.sign({ sub: userId, type: "refresh" }, env.JWT_REFRESH_SECRET, {
    expiresIn: REFRESH_TOKEN_TTL_SECONDS,
  });

const generateAuthTokens = (userId) => {
  const accessToken = createAccessToken(userId);
  const refreshToken = createRefreshToken(userId);

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: buildExpiryDate(ACCESS_TOKEN_TTL_SECONDS),
    refreshTokenExpiresAt: buildExpiryDate(REFRESH_TOKEN_TTL_SECONDS),
  };
};

// Backward-compatible token for existing admin auth flow.
const generateToken = (userId) =>
  jwt.sign({ sub: userId, type: "access" }, env.JWT_SECRET, { expiresIn: "7d" });

module.exports = {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  createAccessToken,
  createRefreshToken,
  generateAuthTokens,
  generateToken,
};
