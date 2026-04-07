const parsePort = (rawPort) => {
  const port = Number(rawPort);
  return Number.isInteger(port) && port > 0 ? port : 4000;
};

const env = {
  PORT: parsePort(process.env.PORT),
  NODE_ENV: process.env.NODE_ENV || "development",
  MONGODB_URI: process.env.MONGODB_URI || "",
  JWT_SECRET: process.env.JWT_SECRET || "",
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN || "*",
};

const validateEnv = () => {
  const missing = [];

  if (!env.MONGODB_URI) missing.push("MONGODB_URI");
  if (!env.JWT_SECRET) missing.push("JWT_SECRET");

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
};

module.exports = {
  env,
  validateEnv,
};
