const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const productController = require("../controllers/productController");

router.use(auth);

router.post("/", productController.createProduct);
router.post("/bulk-upload", productController.bulkUploadProducts);
router.get("/sample-csv", productController.downloadSampleCsv);
router.get("/capital-summary", productController.getCapitalSummary);
router.get("/", productController.getProducts);
router.get("/:id/last-rate", productController.getLastRate);
router.get("/:id/history", productController.getProductHistory);
router.get("/:id", productController.getProductById);
router.put("/:id", productController.updateProduct);
router.delete("/:id", productController.deleteProduct);
router.post("/:id/restore", productController.restoreProduct);

module.exports = router;
