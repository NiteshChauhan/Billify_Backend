const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const controller = require("../controllers/adminApplicatorReportController");

router.use(auth);

router.get("/reports/item-distribution", controller.itemDistribution);
router.get("/reports/applicator-summary", controller.applicatorSummary);
router.get("/reports/item-summary", controller.itemSummary);
router.get("/reports/applicator-summary/pdf", controller.applicatorSummaryPdf);
router.get("/exports/invoices/csv", controller.exportInvoicesCsv);
router.get("/exports/invoices/pdf", controller.exportInvoicesPdf);

module.exports = router;
