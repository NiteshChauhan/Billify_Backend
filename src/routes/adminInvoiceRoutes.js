const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const salesController = require("../controllers/salesController");

router.use(auth);

router.get("/next-number", salesController.getNextSalesInvoiceNumber);
router.get("/check-number", salesController.checkSalesInvoiceNumber);
router.get("/", salesController.getSales);
router.patch("/:id/gst-status", salesController.updateSalesInvoiceGstStatus);

module.exports = router;
