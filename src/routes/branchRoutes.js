const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const { enforceBranchLimit } = require("../middlewares/subscriptionLimitMiddleware");
const branchController = require("../controllers/branchController");

router.use(auth);

router.get("/", branchController.listBranches);
router.post("/", enforceBranchLimit, branchController.createBranch);
router.put("/:id", branchController.updateBranch);

module.exports = router;
