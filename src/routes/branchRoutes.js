const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const branchController = require("../controllers/branchController");

router.use(auth);

router.get("/", branchController.listBranches);
router.post("/", branchController.createBranch);
router.put("/:id", branchController.updateBranch);

module.exports = router;
