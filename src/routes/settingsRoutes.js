const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const controller = require("../controllers/settingsController");

router.use(auth);

router.get("/company", controller.getCompanySettings);
router.post("/company", controller.saveCompanySettings);

module.exports = router;
