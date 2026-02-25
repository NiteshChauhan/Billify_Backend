const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const purchaseController = require("../controllers/purchaseController");

router.use(auth);

router.post("/", purchaseController.createPurchaseInvoice);
router.get("/", purchaseController.getPurchases);
router.get("/:id", purchaseController.getPurchaseById);
router.put("/:id", purchaseController.updatePurchaseInvoice);


module.exports = router;
