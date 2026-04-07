const jwt = require("jsonwebtoken");
const { env } = require("../config/env");

const generateToken = (userId) => {
  return jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: "7d" });
};

module.exports = {
  generateToken,
};
