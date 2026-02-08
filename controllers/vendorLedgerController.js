import SalesInvoice from "../models/SalesInvoice";
import Payment from "../models/Payment";
import Vendor from "../models/Vendor";

export const getVendorLedger = async (req, res) => {
  try {
    // 🔑 Vercel dynamic route param
    const { id } = req.query;
    const companyId = req.user.companyId;

    const vendor = await Vendor.findOne({
      _id: id,
      companyId,
    });

    if (!vendor) {
      return res.status(404).json({ error: "Vendor not found" });
    }

    /* ================= SALES INVOICES ================= */
    const invoices = await SalesInvoice.find({
      vendorId: id,
      companyId,
    });

    /* ================= RECEIPTS ================= */
    const receipts = await Payment.find({
      partyId: id,
      partyType: "VENDOR",
      invoiceType: "SALE",
      companyId,
    });

    let ledger = [];

    invoices.forEach((i) => {
      ledger.push({
        date: i.invoiceDate,
        particulars: `Sales Invoice ${i.invoiceNo || ""}`,
        debit: i.totalAmount || 0,
        credit: 0,
      });
    });

    receipts.forEach((r) => {
      ledger.push({
        date: r.createdAt,
        particulars: `Receipt (${r.paymentMode})`,
        debit: 0,
        credit: r.amount || 0,
      });
    });

    /* ================= SORT BY DATE ================= */
    ledger.sort((a, b) => new Date(a.date) - new Date(b.date));

    /* ================= RUNNING BALANCE ================= */
    let running = vendor.openingBalance || 0;

    ledger = ledger.map((l) => {
      running += l.debit - l.credit;
      return {
        ...l,
        balance: running,
      };
    });

    return res.json({
      vendor,
      openingBalance: vendor.openingBalance || 0,
      closingBalance: running,
      ledger,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
