const bcrypt = require("bcryptjs");
const { env } = require("../config/env");
const User = require("../models/User");

const DEVELOPMENT_ADMIN = {
  name: "Admin",
  username: "admin",
  email: "admin@connect.local",
  password: "Admin@12345",
};

const seedDevelopmentAdmin = async () => {
  if (env.NODE_ENV === "production") {
    return;
  }

  const passwordHash = await bcrypt.hash(DEVELOPMENT_ADMIN.password, 12);
  const existingAdmin = await User.findOne({
    $or: [
      { email: DEVELOPMENT_ADMIN.email },
      { username: DEVELOPMENT_ADMIN.username },
    ],
  });

  if (existingAdmin) {
    existingAdmin.name = DEVELOPMENT_ADMIN.name;
    existingAdmin.username = DEVELOPMENT_ADMIN.username;
    existingAdmin.email = DEVELOPMENT_ADMIN.email;
    existingAdmin.passwordHash = passwordHash;
    existingAdmin.role = "admin";
    await existingAdmin.save();
    console.log(
      "[seed] Development admin account refreshed. Change the default password outside development.",
    );
    return;
  }

  await User.create({
    name: DEVELOPMENT_ADMIN.name,
    username: DEVELOPMENT_ADMIN.username,
    email: DEVELOPMENT_ADMIN.email,
    passwordHash,
    role: "admin",
  });

  console.log(
    "[seed] Development admin account created (username: admin, password: Admin@12345). Do not keep these defaults outside development.",
  );
};

module.exports = {
  seedDevelopmentAdmin,
};
