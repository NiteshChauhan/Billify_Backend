import StockLedger from "@/models/StockLedger";

/* ================= STOCK LEDGER (TALLY STYLE) ================= */
export const getStockLedgerByProduct = async (req, res) => {
  try {
    const { productId } = req.query; // 🔥 Vercel uses query, not params

    const ledger = await StockLedger.find({
      companyId: req.user.companyId,
      productId,
    })
      .sort({ createdAt: 1 }) // ⬅️ chronological (VERY IMPORTANT)
      .lean();

    res.json(ledger);
  } catch (err) {
    res.status(500).json({
      message: "Failed to load stock ledger",
      error: err.message,
    });
  }
};
