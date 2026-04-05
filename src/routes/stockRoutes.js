const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const stockController = require("../controllers/stockController");

router.use(auth);

router.get("/:productId", stockController.getProductStock);
router.post("/adjust", stockController.adjustStock);

module.exports = router;
