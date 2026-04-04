const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const controller = require("../controllers/stockLedgerController");

router.use(auth);

/* 📒 STOCK LEDGER */
router.get("/:productId", controller.getStockLedgerByProduct);

module.exports = router;
