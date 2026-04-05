const router = require("express").Router();
const auth = require("../middlewares/authMiddleware");
const ctrl = require("../controllers/profitController");

router.use(auth);

router.get("/", ctrl.getProfit);

module.exports = router;
