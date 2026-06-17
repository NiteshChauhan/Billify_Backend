const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const controller = require("../controllers/applicatorController");

router.use(auth);

router.get("/", controller.listApplicators);
router.post("/", controller.createApplicator);
router.get("/:id", controller.getApplicator);
router.put("/:id", controller.updateApplicator);
router.patch("/:id/status", controller.updateApplicatorStatus);
router.delete("/:id", controller.deleteApplicator);

module.exports = router;
