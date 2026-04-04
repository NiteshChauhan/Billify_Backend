const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const paymentController = require("../controllers/paymentController");

router.use(auth);

router.post("/", paymentController.createPayment);
router.get("/", paymentController.getPayments);
router.get("/invoice/:invoiceId", paymentController.getPaymentsByInvoice);

module.exports = router;
