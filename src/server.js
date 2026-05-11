require("dotenv").config();
const app = require("./app");
const { connectDb, disconnectDb } = require("./config/db");
const { env, validateEnv } = require("./config/env");
const {
  resumePendingAdminNotificationCampaignProcessing,
} = require("./utils/adminNotifications");

const LISTEN_RETRY_DELAY_MS = 750;
const LISTEN_RETRY_ATTEMPTS = 5;

let server = null;
let isShuttingDown = false;

const wait = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const listen = () =>
  new Promise((resolve, reject) => {
    const nextServer = app.listen(env.PORT, "0.0.0.0");

    const cleanup = () => {
      nextServer.off("error", onError);
      nextServer.off("listening", onListening);
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    const onListening = () => {
      cleanup();
      console.log(`Server listening on port ${env.PORT} (LAN enabled)`);
      resolve(nextServer);
    };

    nextServer.once("error", onError);
    nextServer.once("listening", onListening);
  });

const startListening = async () => {
  for (let attempt = 1; attempt <= LISTEN_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await listen();
    } catch (error) {
      const isLastAttempt = attempt === LISTEN_RETRY_ATTEMPTS;
      if (error?.code !== "EADDRINUSE" || isLastAttempt) {
        throw error;
      }

      console.warn(
        `Port ${env.PORT} is busy. Retrying in ${LISTEN_RETRY_DELAY_MS}ms (${attempt}/${LISTEN_RETRY_ATTEMPTS - 1})...`,
      );
      await wait(LISTEN_RETRY_DELAY_MS);
    }
  }

  return null;
};

const shutdown = async (reason, exitCode = 0) => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  if (reason) {
    console.log(`${reason}. Shutting down server...`);
  }

  try {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  } catch (error) {
    console.error("Failed to close HTTP server:", error.message);
    exitCode = 1;
  }

  try {
    await disconnectDb();
  } catch (error) {
    console.error("Failed to close MongoDB connection:", error.message);
    exitCode = 1;
  }

  process.exit(exitCode);
};

const start = async () => {
  try {
    validateEnv();
    await connectDb(env.MONGODB_URI);
    server = await startListening();
    await resumePendingAdminNotificationCampaignProcessing();
  } catch (error) {
    console.error("Failed to start server:", error.message);
    await disconnectDb().catch(() => {});
    process.exit(1);
  }
};

["SIGINT", "SIGTERM", "SIGBREAK"].forEach((signal) => {
  process.once(signal, () => {
    void shutdown(signal);
  });
});

start();
