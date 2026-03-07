const StockLedger = require("../models/StockLedger");

/* ---------------- ADD OPENING STOCK ---------------- */
exports.addOpeningStock = async (req, res) => {
  try {
    const { productId, quantity, rate } = req.body;

    // 🔒 Check if opening stock already exists
    const exists = await StockLedger.findOne({
      companyId: req.user.companyId,
      productId,
      type: "OPENING"
    });

    if (exists) {
      return res.status(400).json({
        message: "Opening stock already added for this product"
      });
    }

    await StockLedger.create({
      companyId: req.user.companyId,
      productId,
      type: "OPENING",
      quantity,
      rate,
      referenceType: "OPENING_STOCK"
    });

    res.json({ message: "Opening stock added successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ---------------- GET OPENING STOCK ---------------- */
exports.getOpeningStockByProduct = async (req, res) => {
  try {
    const { productId } = req.params;

    const stock = await StockLedger.findOne({
      companyId: req.user.companyId,
      productId,
      type: "OPENING"
    });

    if (!stock) {
      return res.json({ exists: false, editable: true });
    }

    const hasTransactions = await StockLedger.exists({
      companyId: req.user.companyId,
      productId,
      type: { $in: ["PURCHASE", "SALE", "PURCHASE_RETURN", "SALE_RETURN"] },
    });

    res.json({
      exists: true,
      quantity: stock.quantity,
      rate: stock.rate,
      amount: stock.quantity * stock.rate,
      editable: !hasTransactions,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ---------------- UPDATE OPENING STOCK ---------------- */
exports.updateOpeningStock = async (req, res) => {
  try {
    const { productId } = req.params;
    const { quantity, rate } = req.body;

    if (!quantity || Number(quantity) <= 0) {
      return res.status(400).json({ message: "Quantity must be greater than zero" });
    }

    const stock = await StockLedger.findOne({
      companyId: req.user.companyId,
      productId,
      type: "OPENING",
    });

    if (!stock) {
      return res.status(404).json({ message: "Opening stock not found" });
    }

    const hasTransactions = await StockLedger.exists({
      companyId: req.user.companyId,
      productId,
      type: { $in: ["PURCHASE", "SALE", "PURCHASE_RETURN", "SALE_RETURN"] },
    });

    if (hasTransactions) {
      return res.status(400).json({
        message: "Opening stock cannot be edited after purchase/sale/return entries exist",
      });
    }

    stock.quantity = Number(quantity);
    stock.rate = Number(rate || 0);
    await stock.save();

    res.json({
      message: "Opening stock updated successfully",
      quantity: stock.quantity,
      rate: stock.rate,
      amount: stock.quantity * stock.rate,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
