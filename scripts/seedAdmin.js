require("dotenv").config();
const bcrypt = require("bcryptjs");
const { connectDb, disconnectDb } = require("../src/config/db");
const User = require("../src/models/User");

const parseArgs = () => {
  const args = process.argv.slice(2);
  const result = {};

  args.forEach((arg) => {
    const [key, ...rest] = arg.split("=");
    const value = rest.join("=");
    if (!key.startsWith("--")) return;
    result[key.slice(2)] = value || "true";
  });

  return result;
};

const resolveAdminSeedInput = () => {
  const args = parseArgs();

  return {
    name: (args.name || process.env.ADMIN_SEED_NAME || "System Admin").trim(),
    email: (args.email || process.env.ADMIN_SEED_EMAIL || "").trim().toLowerCase(),
    password: (args.password || process.env.ADMIN_SEED_PASSWORD || "").trim(),
  };
};

const run = async () => {
  const { name, email, password } = resolveAdminSeedInput();

  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is required");
  }

  if (!email || !password) {
    throw new Error(
      "Admin seed requires email and password. Use env vars ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD or CLI flags --email=... --password=...",
    );
  }

  if (password.length < 8) {
    throw new Error("Admin password must be at least 8 characters");
  }

  await connectDb(process.env.MONGODB_URI);

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    if (existingUser.role === "admin") {
      console.log(`Admin already exists for ${email}`);
      return;
    }

    throw new Error(
      `User ${email} already exists but is not admin. Promote manually if needed.`,
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const adminUser = await User.create({
    name,
    email,
    passwordHash,
    role: "admin",
  });

  console.log(`Admin created: ${adminUser.email} (${adminUser._id.toString()})`);
};

run()
  .catch((error) => {
    console.error("[seed-admin] Failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDb().catch(() => {});
  });
