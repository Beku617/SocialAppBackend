const express = require("express");
const { getMyPushTokensDebug } = require("../controllers/authController");
const { requireAuth } = require("../middlewares/auth");

const router = express.Router();

router.get("/my-tokens", requireAuth, getMyPushTokensDebug);

module.exports = router;
