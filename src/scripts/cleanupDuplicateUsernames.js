require("dotenv").config();
const mongoose = require("mongoose");
const { connectDb } = require("../config/db");
const { env, validateEnv } = require("../config/env");
const User = require("../models/User");

const run = async () => {
  const apply = process.argv.includes("--apply");

  try {
    validateEnv();
    await connectDb(env.MONGODB_URI);

    const duplicateGroups = await User.aggregate([
      {
        $match: {
          username: { $type: "string", $ne: "" },
        },
      },
      {
        $group: {
          _id: { $toLower: "$username" },
          count: { $sum: 1 },
          users: {
            $push: {
              _id: "$_id",
              username: "$username",
              createdAt: "$createdAt",
              email: "$email",
              name: "$name",
            },
          },
        },
      },
      {
        $match: { count: { $gt: 1 } },
      },
      {
        $sort: { _id: 1 },
      },
    ]);

    if (duplicateGroups.length === 0) {
      console.log("[cleanup-usernames] No duplicate usernames found.");
      return;
    }

    let totalUsersToDelete = 0;
    const deleteIds = [];

    duplicateGroups.forEach((group) => {
      const users = [...group.users].sort((left, right) => {
        const leftTime = new Date(left.createdAt || 0).getTime();
        const rightTime = new Date(right.createdAt || 0).getTime();
        if (leftTime !== rightTime) return leftTime - rightTime;
        return String(left._id).localeCompare(String(right._id));
      });

      const keep = users[0];
      const remove = users.slice(1);
      totalUsersToDelete += remove.length;
      remove.forEach((item) => deleteIds.push(item._id));

      console.log(
        `[cleanup-usernames] username="${group._id}" keep=${keep._id} remove=${remove
          .map((item) => String(item._id))
          .join(", ")}`,
      );
    });

    console.log(
      `[cleanup-usernames] duplicate groups=${duplicateGroups.length}, users to delete=${totalUsersToDelete}`,
    );

    if (!apply) {
      console.log(
        "[cleanup-usernames] Dry run complete. Re-run with --apply to delete duplicate accounts.",
      );
      return;
    }

    if (deleteIds.length > 0) {
      const result = await User.deleteMany({ _id: { $in: deleteIds } });
      console.log(
        `[cleanup-usernames] Deleted ${result.deletedCount || 0} duplicate user documents.`,
      );
    }
  } catch (error) {
    console.error("[cleanup-usernames] Failed:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

void run();
