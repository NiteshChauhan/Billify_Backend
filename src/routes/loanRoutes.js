const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const controller = require("../controllers/loanController");

router.use(auth);

router.get("/", controller.getLoans);
router.post("/", controller.createLoan);
router.put("/:id", controller.updateLoan);
router.delete("/:id", controller.deleteLoan);
router.post("/:id/restore", controller.restoreLoan);

module.exports = router;
