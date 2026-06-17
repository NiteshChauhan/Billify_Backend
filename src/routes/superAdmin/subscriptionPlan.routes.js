const express = require("express");
const router = express.Router();
const superAdminAuth = require("../../middlewares/superAdminAuthMiddleware");
const controller = require("../../controllers/superAdmin/subscriptionPlan.controller");

router.use(superAdminAuth);

router.post("/", controller.createPlan);
router.get("/", controller.getPlans);
router.get("/:id", controller.getPlan);
router.put("/:id", controller.updatePlan);
router.patch("/:id/status", controller.changeStatus);
router.delete("/:id", controller.deletePlan);

module.exports = router;
