const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const controller = require("../controllers/siteController");

router.use(auth);

router.get("/", controller.listSites);
router.post("/", controller.createSite);
router.get("/:id", controller.getSite);
router.put("/:id", controller.updateSite);
router.patch("/:id/status", controller.updateSiteStatus);
router.delete("/:id", controller.deleteSite);

module.exports = router;
