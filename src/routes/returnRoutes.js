const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const returnController = require("../controllers/returnController");

router.use(auth);

router.get("/", returnController.getReturns);
router.post("/sale", returnController.createSaleReturn);
router.post("/purchase", returnController.createPurchaseReturn);

module.exports = router;

