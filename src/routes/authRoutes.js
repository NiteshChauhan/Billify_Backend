const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const auth = require("../middlewares/authMiddleware");

router.post("/register", authController.registerAdmin);
router.post("/login", authController.login);
router.post("/change-password", auth, authController.changePassword);
router.post("/logout", auth, authController.logout);

module.exports = router;
