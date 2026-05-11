const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});
const mongoose = require("mongoose");
const User = require("../src/models/User");

const sortUsersForKeep = (users) =>
  [...users].sort((left, right) => {
    const leftCreated = new Date(left.createdAt || 0).getTime();
    const rightCreated = new Date(right.createdAt || 0).getTime();
    if (leftCreated !== rightCreated) {
      return leftCreated - rightCreated;
    }
    return left._id.toString().localeCompare(right._id.toString());
  });

const dedupeByField = async (fieldName) => {
  const duplicateGroups = await User.aggregate([
    {
      $match: {
        [fieldName]: { $type: "string", $ne: "" },
      },
    },
    {
      $group: {
        _id: `$${fieldName}`,
        ids: { $push: "$_id" },
        count: { $sum: 1 },
      },
    },
    {
      $match: {
        count: { $gt: 1 },
      },
    },
  ]);

  let removed = 0;
  for (const group of duplicateGroups) {
    const users = await User.find({ _id: { $in: group.ids } })
      .select("_id createdAt email username")
      .lean();

    const sorted = sortUsersForKeep(users);
    const toRemove = sorted.slice(1).map((user) => user._id);
    if (!toRemove.length) continue;

    const result = await User.deleteMany({ _id: { $in: toRemove } });
    removed += result.deletedCount || 0;
  }

  return { groups: duplicateGroups.length, removed };
};

const run = async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error("Missing MONGODB_URI");
  }

  await mongoose.connect(process.env.MONGODB_URI);

  try {
    const emailResult = await dedupeByField("email");
    const usernameResult = await dedupeByField("username");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          email: emailResult,
          username: usernameResult,
        },
        null,
        2,
      ),
    );
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((error) => {
  console.error("dedupe-failed", error?.message || error);
  process.exit(1);
});
