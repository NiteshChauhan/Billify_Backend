const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const purchaseController = require("../controllers/purchaseController");

router.use(auth);

router.post("/", purchaseController.createPurchaseInvoice);
router.get("/", purchaseController.getPurchases);
router.post("/:id/restore", purchaseController.restorePurchaseInvoice);
router.get("/:id", purchaseController.getPurchaseById);
router.put("/:id", purchaseController.updatePurchaseInvoice);
router.delete("/:id", purchaseController.deletePurchaseInvoice);


module.exports = router;
