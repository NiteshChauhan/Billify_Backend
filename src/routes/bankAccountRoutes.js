const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const controller = require("../controllers/bankAccountController");

router.use(auth);

router.get("/", controller.getBankAccounts);
router.post("/", controller.createBankAccount);

module.exports = router;
