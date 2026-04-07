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

    app.listen(env.PORT, () => {
      console.log(`Server listening on http://localhost:${env.PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
};

start();
