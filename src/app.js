const cors = require("cors");
const express = require("express");
const helmet = require("helmet");
const morgan = require("morgan");
const fs = require("fs");
const path = require("path");
const { env } = require("./config/env");
const adminRoutes = require("./routes/adminRoutes");
const authRoutes = require("./routes/authRoutes");
const healthRoutes = require("./routes/healthRoutes");
const postRoutes = require("./routes/postRoutes");
const storyRoutes = require("./routes/storyRoutes");
const messageRoutes = require("./routes/messageRoutes");
const reelRoutes = require("./routes/reelRoutes");
const reelCommentRoutes = require("./routes/reelCommentRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const { errorHandler, notFound } = require("./middlewares/errorHandler");

const app = express();

const buildCorsOptions = (allowedOrigins) => {
  if (!allowedOrigins || allowedOrigins === "*") {
    return { origin: true };
  }

  const whitelist = allowedOrigins.split(",").map((origin) => origin.trim());
  return {
    origin: (origin, callback) => {
      if (!origin || whitelist.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("CORS blocked for this origin"));
    },
  };
};

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
app.use(cors(buildCorsOptions(env.CLIENT_ORIGIN)));
app.use(express.json({ limit: "80mb" }));

const uploadsDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use(
  "/uploads",
  express.static(uploadsDir, {
    setHeaders: (res) => {
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    },
  }),
);

if (env.NODE_ENV !== "test") {
  app.use(morgan("dev"));
}

app.get("/", (_req, res) => {
  res.json({ message: "API is running" });
});
app.get("/posts/:postId", (req, res) => {
  return res.redirect(302, `/api/posts/${req.params.postId}`);
});

app.use("/health", healthRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/posts", postRoutes);
app.use("/api/stories", storyRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/reels", reelRoutes);
app.use("/api/reels", reelCommentRoutes);
app.use("/api/notifications", notificationRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
