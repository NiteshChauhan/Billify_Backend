const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const salesController = require("../controllers/salesController");

router.use(auth);

router.post("/", salesController.createSalesInvoice);
router.get("/", salesController.getSales);
router.get("/:id", salesController.getSalesById);
router.put("/:id", salesController.updateSalesInvoice);

module.exports = router;
