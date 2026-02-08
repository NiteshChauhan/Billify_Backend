import PurchaseInvoice from "../models/PurchaseInvoice";
import Payment from "../models/Payment";
import Supplier from "../models/Supplier";

export const getSupplierLedger = async (req, res) => {
  try {
    const { supplierId } = req.query; // ⬅️ IMPORTANT for Vercel
    const companyId = req.user.companyId;

    const supplier = await Supplier.findOne({
      _id: supplierId,
      companyId,
    });

    if (!supplier) {
      return res.status(404).json({ message: "Supplier not found" });
    }

    /* ---------------- Purchases ---------------- */
    const purchases = await PurchaseInvoice.find({
      companyId,
      supplierId,
    }).select("invoiceDate totalAmount invoiceNo");

    /* ---------------- Payments ---------------- */
    const payments = await Payment.find({
      companyId,
      partyType: "SUPPLIER",
      partyId: supplierId,
    }).select("paymentDate amount paymentMode referenceNo");

    /* ---------------- Merge Ledger ---------------- */
    let ledger = [];

    purchases.forEach((p) => {
      ledger.push({
        date: p.invoiceDate,
        type: "PURCHASE",
        particulars: "Purchase Invoice",
        debit: p.totalAmount,
        credit: 0,
      });
    });

    payments.forEach((p) => {
      ledger.push({
        date: p.paymentDate,
        type: "PAYMENT",
        particulars: `Payment (${p.paymentMode})`,
        debit: 0,
        credit: p.amount,
      });
    });

    /* ---------------- Sort by Date ---------------- */
    ledger.sort((a, b) => new Date(a.date) - new Date(b.date));

    /* ---------------- Running Balance ---------------- */
    let balance = supplier.openingBalance || 0;

    ledger = ledger.map((entry) => {
      balance = balance + entry.debit - entry.credit;
      return { ...entry, balance };
    });

    return res.json({
      supplier,
      ledger,
    });
  } catch (err) {
    return res.status(500).json({
      message: "Failed to load supplier ledger",
      error: err.message,
    });
  }
};
