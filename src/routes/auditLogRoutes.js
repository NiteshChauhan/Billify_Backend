const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const controller = require("../controllers/auditLogController");

router.use(auth);

router.get("/", controller.getAuditLogs);

module.exports = router;
