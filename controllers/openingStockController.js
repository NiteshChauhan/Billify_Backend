import StockLedger from "../models/StockLedger";

/* ---------------- ADD OPENING STOCK ---------------- */
export const addOpeningStock = async (req, res) => {
  try {
    const { productId, quantity, rate } = req.body;
    const companyId = req.user.companyId;

    if (!productId || !quantity || !rate) {
      return res.status(400).json({
        message: "Product, quantity and rate are required",
      });
    }

    const exists = await StockLedger.findOne({
      companyId,
      productId,
      type: "OPENING",
    });

    if (exists) {
      return res.status(400).json({
        message: "Opening stock already added for this product",
      });
    }

    await StockLedger.create({
      companyId,
      productId,
      type: "OPENING",
      quantity,
      rate,
      referenceType: "OPENING_STOCK",
    });

    res.status(201).json({
      success: true,
      message: "Opening stock added successfully",
    });
  } catch (err) {
    console.error("Opening Stock Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/* ---------------- GET OPENING STOCK ---------------- */
export const getOpeningStockByProduct = async (req, res) => {
  try {
    const { productId } = req.query;
    const companyId = req.user.companyId;

    const stock = await StockLedger.findOne({
      companyId,
      productId,
      type: "OPENING",
    });

    if (!stock) {
      return res.json({ exists: false });
    }

    res.json({
      exists: true,
      quantity: stock.quantity,
      rate: stock.rate,
      amount: stock.quantity * stock.rate,
    });
  } catch (err) {
    console.error("Get Opening Stock Error:", err);
    res.status(500).json({ error: err.message });
  }
};
