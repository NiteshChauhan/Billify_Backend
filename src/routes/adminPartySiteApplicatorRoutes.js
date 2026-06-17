const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const controller = require("../controllers/partySiteApplicatorController");

router.use(auth);

router.get("/by-site", controller.listBySite);
router.get("/", controller.listAssignments);
router.post("/", controller.createAssignment);
router.get("/:id", controller.getAssignment);
router.put("/:id", controller.updateAssignment);
router.patch("/:id/status", controller.updateAssignmentStatus);
router.delete("/:id", controller.deleteAssignment);

module.exports = router;
