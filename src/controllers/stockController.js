const StockLedger = require("../models/StockLedger");
const Product = require("../models/Product");
const { getAvailableStock } = require("../utils/stockUtils");

/* ================= GET PRODUCT STOCK ================= */
exports.getProductStock = async (req, res) => {
  try {
    const { productId } = req.params;
    const branchScope = req.user.branchScope || req.user.branchId || null;
    const stock = await getAvailableStock(req.user.companyId, branchScope, productId);

    res.json({ productId, stock });
  } catch (err) {
    console.error("Get Product Stock Error:", err);
    res.status(500).json({ error: "Failed to fetch product stock" });
  }
};

/* ================= ADJUST STOCK ================= */
exports.adjustStock = async (req, res) => {
  try {
    const { productId, quantity, rate } = req.body;

    if (!productId || !quantity) {
      return res
        .status(400)
        .json({ error: "productId and quantity are required" });
    }

    await StockLedger.create({
      companyId: req.user.companyId,
      branchId: req.user.branchId || null,
      productId,
      type: "ADJUSTMENT",
      quantity,
      rate,
      referenceType: "MANUAL_ADJUSTMENT",
    });

    res.json({ message: "Stock adjusted successfully" });
  } catch (err) {
    console.error("Adjust Stock Error:", err);
    res.status(500).json({ error: "Failed to adjust stock" });
  }
};
