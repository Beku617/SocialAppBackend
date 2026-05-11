const mongoose = require("mongoose");

const connectDb = async (uri) => {
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  console.log("MongoDB connected");
};

const disconnectDb = async () => {
  if (mongoose.connection.readyState === 0) {
    return;
  }

  await mongoose.disconnect();
  console.log("MongoDB disconnected");
};

module.exports = {
  connectDb,
  disconnectDb,
};
