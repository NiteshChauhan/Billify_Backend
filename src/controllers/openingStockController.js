const {
  getOpeningStockSnapshot,
  assertOpeningStockEditable,
  syncOpeningStock,
} = require("../utils/openingStockUtils");

/* ---------------- ADD OPENING STOCK ---------------- */
exports.addOpeningStock = async (req, res) => {
  try {
    const { productId, quantity, rate } = req.body;
    const normalizedQuantity = Number(quantity || 0);

    if (!productId) {
      return res.status(400).json({ message: "productId is required" });
    }

    if (!(normalizedQuantity > 0)) {
      return res.status(400).json({ message: "Quantity must be greater than zero" });
    }

    const snapshot = await getOpeningStockSnapshot(req.user.companyId, req.user.branchId || null, productId);

    if (!snapshot.product) {
      return res.status(404).json({ message: "Product not found" });
    }

    if (snapshot.openingEntry) {
      return res.status(400).json({
        message: "Opening stock already added for this product",
      });
    }

    const result = await syncOpeningStock({
      companyId: req.user.companyId,
      branchId: req.user.branchId || null,
      productId,
      quantity: normalizedQuantity,
      rate,
    });

    res.json({
      message: "Opening stock added successfully",
      quantity: result.quantity,
      rate: result.rate,
      amount: result.amount,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

/* ---------------- GET OPENING STOCK ---------------- */
exports.getOpeningStockByProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    const snapshot = await getOpeningStockSnapshot(req.user.companyId, req.user.branchId || null, productId);

    if (!snapshot.openingEntry) {
      return res.json({ exists: false, editable: true });
    }

    res.json({
      exists: true,
      quantity: snapshot.quantity,
      rate: snapshot.rate,
      amount: snapshot.quantity * snapshot.rate,
      editable: true,
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

    const snapshot = await assertOpeningStockEditable(
      req.user.companyId,
      req.user.branchId || null,
      productId,
      quantity,
      rate,
    );

    if (!snapshot.product) {
      return res.status(404).json({ message: "Product not found" });
    }

    if (!snapshot.openingEntry) {
      return res.status(404).json({ message: "Opening stock not found" });
    }

    const result = await syncOpeningStock({
      companyId: req.user.companyId,
      branchId: req.user.branchId || null,
      productId,
      quantity,
      rate,
    });

    res.json({
      message: "Opening stock updated successfully",
      quantity: result.quantity,
      rate: result.rate,
      amount: result.amount,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};
