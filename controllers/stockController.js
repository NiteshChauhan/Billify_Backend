import StockLedger from "@/models/StockLedger";
import { getAvailableStock } from "@/utils/stockUtils";

/* ================= GET PRODUCT STOCK ================= */
export const getProductStock = async (req, res) => {
  try {
    const { productId } = req.query; // 🔥 Vercel uses query

    const stock = await getAvailableStock(req.user.companyId, productId);

    res.json({ productId, stock });
  } catch (err) {
    res.status(500).json({
      message: "Failed to fetch stock",
      error: err.message,
    });
  }
};

/* ================= MANUAL STOCK ADJUSTMENT ================= */
export const adjustStock = async (req, res) => {
  try {
    const { productId, quantity, rate } = req.body;

    if (!productId || !quantity) {
      return res.status(400).json({
        message: "Product and quantity are required",
      });
    }

    await StockLedger.create({
      companyId: req.user.companyId,
      productId,
      type: "ADJUSTMENT",
      quantity,
      rate,
      referenceType: "MANUAL_ADJUSTMENT",
    });

    res.json({ message: "Stock adjusted successfully" });
  } catch (err) {
    res.status(500).json({
      message: "Failed to adjust stock",
      error: err.message,
    });
  }
};
