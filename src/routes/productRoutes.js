const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const productController = require("../controllers/productController");

router.use(auth);

router.post("/", productController.createProduct);
router.get("/", productController.getProducts);
router.get("/:id/history", productController.getProductHistory);
router.get("/:id", productController.getProductById);
router.put("/:id", productController.updateProduct);
router.delete("/:id", productController.deleteProduct);

module.exports = router;
