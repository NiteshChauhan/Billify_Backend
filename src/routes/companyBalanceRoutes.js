const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const controller = require("../controllers/companyBalanceController");

router.use(auth);

router.get("/", controller.getCompanyBalance);
router.post("/", controller.saveCompanyBalance);

module.exports = router;
