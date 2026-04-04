const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const dashboardController = require("../controllers/dashboardController");

router.use(auth);

router.get("/summary", dashboardController.getDashboardSummary);

module.exports = router;
