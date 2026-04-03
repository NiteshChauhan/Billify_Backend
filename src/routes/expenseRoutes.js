const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const controller = require("../controllers/expenseController");

router.use(auth);

router.get("/", controller.getExpenses);
router.post("/", controller.createExpense);

module.exports = router;
