import Payment from "../models/Payment";
import Supplier from "../models/Supplier";
import Vendor from "../models/Vendor";
import PurchaseInvoice from "../models/PurchaseInvoice";
import SalesInvoice from "../models/SalesInvoice";

/* ================= CREATE PAYMENT ================= */
export const createPayment = async (req, res) => {
  try {
    const {
      partyType,
      partyId,
      invoiceType,
      invoiceId,
      amount,
      paymentMode,
      referenceNo,
      remarks,
    } = req.body;

    const companyId = req.user.companyId;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid payment amount" });
    }

    /* ================= PURCHASE PAYMENT ================= */
    if (invoiceType === "PURCHASE") {
      const invoice = await PurchaseInvoice.findOne({
        _id: invoiceId,
        companyId,
      });

      if (!invoice) {
        return res.status(404).json({ error: "Purchase invoice not found" });
      }

      const payments = await Payment.find({
        companyId,
        invoiceId,
        invoiceType: "PURCHASE",
      });

      const alreadyPaid = payments.reduce((t, p) => t + p.amount, 0);
      const balance = invoice.totalAmount - alreadyPaid;

      if (amount > balance) {
        return res.status(400).json({
          error: `Payment exceeds outstanding amount (₹${balance})`,
        });
      }

      const payment = await Payment.create({
        companyId,
        partyType,
        partyId,
        invoiceType,
        invoiceId,
        amount,
        paymentMode,
        referenceNo,
        remarks,
      });

      const supplier = await Supplier.findById(partyId);
      supplier.balance -= amount;
      await supplier.save();

      invoice.paidAmount = alreadyPaid + amount;
      invoice.status =
        invoice.paidAmount >= invoice.totalAmount ? "PAID" : "PARTIAL";
      await invoice.save();

      return res.status(201).json({ payment, invoice });
    }

    /* ================= SALES PAYMENT ================= */
    if (invoiceType === "SALE") {
      const invoice = await SalesInvoice.findOne({
        _id: invoiceId,
        companyId,
      });

      if (!invoice) {
        return res.status(404).json({ error: "Sales invoice not found" });
      }

      const payments = await Payment.find({
        companyId,
        invoiceId,
        invoiceType: "SALE",
      });

      const alreadyPaid = payments.reduce((t, p) => t + p.amount, 0);
      const balance = invoice.totalAmount - alreadyPaid;

      if (amount > balance) {
        return res.status(400).json({
          error: `Payment exceeds outstanding amount (₹${balance})`,
        });
      }

      const payment = await Payment.create({
        companyId,
        partyType,
        partyId,
        invoiceType,
        invoiceId,
        amount,
        paymentMode,
        referenceNo,
        remarks,
      });

      const vendor = await Vendor.findById(partyId);
      vendor.balance -= amount;
      await vendor.save();

      invoice.paidAmount = alreadyPaid + amount;
      invoice.status =
        invoice.paidAmount >= invoice.totalAmount ? "PAID" : "PARTIAL";
      await invoice.save();

      return res.status(201).json({ payment, invoice });
    }

    return res.status(400).json({ error: "Invalid invoice type" });
  } catch (err) {
    console.error("Payment Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/* ================= GET PAYMENTS BY INVOICE ================= */
export const getPaymentsByInvoice = async (req, res) => {
  try {
    const { invoiceId } = req.query;
    const companyId = req.user.companyId;

    const payments = await Payment.find({
      companyId,
      invoiceId,
    }).sort({ createdAt: 1 });

    res.json(payments);
  } catch (err) {
    console.error("Get Payments Error:", err);
    res.status(500).json({ error: err.message });
  }
};
