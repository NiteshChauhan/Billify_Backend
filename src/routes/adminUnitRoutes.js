const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const controller = require("../controllers/unitController");

router.use(auth);

router.get("/", controller.listUnits);
router.post("/", controller.createUnit);
router.get("/:id", controller.getUnit);
router.put("/:id", controller.updateUnit);
router.patch("/:id/status", controller.updateUnitStatus);
router.delete("/:id", controller.deleteUnit);

module.exports = router;
