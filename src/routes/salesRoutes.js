const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const { enforceInvoiceLimit } = require("../middlewares/subscriptionLimitMiddleware");
const salesController = require("../controllers/salesController");

router.use(auth);

router.post("/", enforceInvoiceLimit, salesController.createSalesInvoice);
router.get("/replacement-bills", salesController.getReplacementBills);
router.get("/", salesController.getSales);
router.post("/:id/restore", salesController.restoreSalesInvoice);
router.get("/:id", salesController.getSalesById);
router.put("/:id", salesController.updateSalesInvoice);
router.delete("/:id", salesController.deleteSalesInvoice);

module.exports = router;
