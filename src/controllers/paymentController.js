const Payment = require("../models/Payment");
const Party = require("../models/Party");
const PurchaseInvoice = require("../models/PurchaseInvoice");
const SalesInvoice = require("../models/SalesInvoice");
const { getDateRangeFromQuery } = require("../utils/dateRange");

/* ================= CREATE PAYMENT ================= */
exports.createPayment = async (req, res) => {
  try {
    const {
      partyId: bodyPartyId,
      invoiceType,
      invoiceId,
      amount,
      paymentMode,
      referenceNo,
      remarks,
    } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid payment amount" });
    }

    /* =====================================================
       🟢 PURCHASE PAYMENT (We pay Supplier)
       Liability decreases
    ===================================================== */
    if (invoiceType === "PURCHASE") {
      const invoice = await PurchaseInvoice.findOne({
        _id: invoiceId,
        companyId: req.user.companyId,
      });

      if (!invoice) {
        return res.status(404).json({ error: "Purchase invoice not found" });
      }

      const partyId = bodyPartyId || invoice.partyId?.toString();
      if (!partyId) {
        return res.status(400).json({ error: "partyId is required" });
      }

      const payments = await Payment.find({
        companyId: req.user.companyId,
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
        companyId: req.user.companyId,
        partyId,
        invoiceType,
        invoiceId,
        paymentType: "PAID",
        amount,
        paymentMode,
        referenceNo,
        remarks,
      });

      /* 🔄 UPDATE PARTY BALANCE */
      const party = await Party.findById(partyId);
      party.balance -= amount; // We paid supplier → liability reduced
      await party.save();

      invoice.paidAmount = alreadyPaid + amount;
      invoice.status =
        invoice.paidAmount >= invoice.totalAmount ? "PAID" : "PARTIAL";

      await invoice.save();

      return res.json({ payment, invoice });
    }

    /* =====================================================
       🔵 SALES PAYMENT (Customer pays us)
       Receivable decreases
    ===================================================== */
    if (invoiceType === "SALE") {
      const invoice = await SalesInvoice.findOne({
        _id: invoiceId,
        companyId: req.user.companyId,
      });

      if (!invoice) {
        return res.status(404).json({ error: "Sales invoice not found" });
      }

      const partyId = bodyPartyId || invoice.partyId?.toString();
      if (!partyId) {
        return res.status(400).json({ error: "partyId is required" });
      }

      const payments = await Payment.find({
        companyId: req.user.companyId,
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
        companyId: req.user.companyId,
        partyId,
        invoiceType,
        invoiceId,
        paymentType: "RECEIVED",
        amount,
        paymentMode,
        referenceNo,
        remarks,
      });

      /* 🔄 UPDATE PARTY BALANCE */
      const party = await Party.findById(partyId);
      party.balance -= amount; // Customer paid → receivable reduced
      await party.save();

      invoice.paidAmount = alreadyPaid + amount;
      invoice.status =
        invoice.paidAmount >= invoice.totalAmount ? "PAID" : "PARTIAL";

      await invoice.save();

      return res.json({ payment, invoice });
    }

    return res.status(400).json({
      error: "Invalid invoice type",
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
};

/* ================= GET PAYMENTS BY INVOICE ================= */
exports.getPaymentsByInvoice = async (req, res) => {
  const query = {
    companyId: req.user.companyId,
    invoiceId: req.params.invoiceId,
  };
  const dateRange = getDateRangeFromQuery(req.query);
  if (dateRange) {
    query.paymentDate = { $gte: dateRange.fromDate, $lte: dateRange.toDate };
  }

  const payments = await Payment.find(query).sort({ createdAt: 1 });

  res.json(payments);
};

/* ================= GET PAYMENTS LIST ================= */
exports.getPayments = async (req, res) => {
  const query = { companyId: req.user.companyId };
  const dateRange = getDateRangeFromQuery(req.query);
  if (dateRange) {
    query.paymentDate = { $gte: dateRange.fromDate, $lte: dateRange.toDate };
  }

  const payments = await Payment.find(query)
    .populate("partyId", "name")
    .sort({ paymentDate: -1, createdAt: -1 });

  res.json(payments);
};
