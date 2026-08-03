const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const controller = require("../controllers/analyticsController");

router.use(auth);

router.get("/invoices", controller.getInvoiceAnalytics);

module.exports = router;
