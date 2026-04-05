const router = require("express").Router();
const auth = require("../middlewares/authMiddleware");
const ctrl = require("../controllers/invoicePdfController");

router.use(auth);

router.get("/sales/:id", ctrl.salesInvoicePDF);
router.get("/purchase/:id", ctrl.purchaseInvoicePDF);

module.exports = router;
