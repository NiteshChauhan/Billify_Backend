const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const controller = require("../controllers/expenseController");

router.use(auth);

router.get("/", controller.getExpenses);
router.post("/", controller.createExpense);
router.put("/:id", controller.updateExpense);
router.delete("/:id", controller.deleteExpense);
router.post("/:id/restore", controller.restoreExpense);

module.exports = router;
