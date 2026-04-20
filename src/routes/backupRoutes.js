const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const controller = require("../controllers/backupController");

router.use(auth);

router.get("/export", controller.downloadBackup);
router.post("/restore", controller.restoreBackup);

module.exports = router;
