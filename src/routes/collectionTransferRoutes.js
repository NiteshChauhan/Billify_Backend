const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const controller = require("../controllers/collectionTransferController");

router.use(auth);
router.get("/", controller.listTransfers);
router.post("/", controller.createTransfer);

module.exports = router;
