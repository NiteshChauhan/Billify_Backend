const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const controller = require("../controllers/openingStockController");

router.use(auth);

/* CREATE OPENING STOCK */
router.post("/", controller.addOpeningStock);

/* CHECK OPENING STOCK */
router.get("/:productId", controller.getOpeningStockByProduct);
router.put("/:productId", controller.updateOpeningStock);

module.exports = router;
