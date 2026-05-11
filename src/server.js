require("dotenv").config();
const app = require("./app");
const { connectDb } = require("./config/db");
const { env, validateEnv } = require("./config/env");
const { seedDevelopmentAdmin } = require("./utils/seedDevelopmentAdmin");

const start = async () => {
  try {
    validateEnv();
    await connectDb(env.MONGODB_URI);
    await seedDevelopmentAdmin();

    const server = app.listen(env.PORT, () => {
      console.log(`Server listening on http://localhost:${env.PORT}`);
      console.log(
        `HTTP timeout set to ${env.SERVER_TIMEOUT_MS}ms, upload timeout set to ${env.REELS_UPLOAD_TIMEOUT_MS}ms`,
      );
    });

    server.requestTimeout = env.SERVER_TIMEOUT_MS;
    server.headersTimeout = env.SERVER_TIMEOUT_MS + 5000;
    server.timeout = env.SERVER_TIMEOUT_MS;
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
};

start();
