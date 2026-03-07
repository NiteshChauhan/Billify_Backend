const PurchaseInvoice = require("../models/PurchaseInvoice");
const StockLedger = require("../models/StockLedger");
const Party = require("../models/Party");
const Payment = require("../models/Payment");
const { getDateRangeFromQuery } = require("../utils/dateRange");

const toPurchaseResponse = (invoiceDoc) => {
  const invoice = invoiceDoc.toObject ? invoiceDoc.toObject() : invoiceDoc;
  return {
    ...invoice,
    supplierId: invoice.partyId,
  };
};

/* ================= CREATE PURCHASE INVOICE ================= */
exports.createPurchaseInvoice = async (req, res) => {
  try {
    const {
      partyId: bodyPartyId,
      supplierId,
      items,
      tax = 0,
      paidAmount = 0,
      invoiceDate,
    } = req.body;
    const partyId = bodyPartyId || supplierId;

    if (!partyId || !items || items.length === 0) {
      return res.status(400).json({
        message: "Party and items are required",
      });
    }

    /* 🔎 Validate Party is Supplier */
    const party = await Party.findOne({
      _id: partyId,
      companyId: req.user.companyId,
      roles: "supplier",
    });

    if (!party) {
      return res.status(400).json({
        message: "Invalid supplier party",
      });
    }

    let subtotal = 0;
    items.forEach((i) => {
      if (!i.productId || !i.quantity || !i.rate) {
        throw new Error("Invalid item data");
      }
      i.amount = i.quantity * i.rate;
      subtotal += i.amount;
    });

    const totalAmount = subtotal + tax;

    if (paidAmount > totalAmount) {
      return res.status(400).json({
        message: "Paid amount cannot exceed invoice total",
      });
    }

    /* 🔢 AUTO INVOICE NUMBER */
    const count = await PurchaseInvoice.countDocuments({
      companyId: req.user.companyId,
    });

    const invoiceNo = `PUR-${count + 1}`;

    /* ✅ CREATE INVOICE */
    const invoice = await PurchaseInvoice.create({
      companyId: req.user.companyId,
      partyId,
      invoiceNo,
      invoiceDate,
      items,
      subtotal,
      tax,
      totalAmount,
      paidAmount: 0,
      status: "DUE",
    });

    /* 📦 STOCK LEDGER ENTRY */
    for (const item of items) {
      await StockLedger.create({
        companyId: req.user.companyId,
        productId: item.productId,
        type: "PURCHASE",
        quantity: item.quantity,
        rate: item.rate,
        referenceType: "PURCHASE_INVOICE",
        referenceId: invoice._id,
      });
    }

    /* ================= HANDLE INITIAL PAYMENT ================= */
    let finalPaidAmount = 0;

    if (paidAmount > 0) {
      await Payment.create({
        companyId: req.user.companyId,
        partyId,
        invoiceType: "PURCHASE",
        invoiceId: invoice._id,
        amount: paidAmount,
        paymentMode: "CASH",
        remarks: "Payment at invoice creation",
      });

      finalPaidAmount = paidAmount;
    }

    /* 🔄 UPDATE INVOICE */
    invoice.paidAmount = finalPaidAmount;
    invoice.status =
      finalPaidAmount === totalAmount
        ? "PAID"
        : finalPaidAmount > 0
          ? "PARTIAL"
          : "DUE";

    await invoice.save();

    /* 💰 UPDATE PARTY BALANCE */
    party.balance = party.balance || 0;
    party.balance += totalAmount - finalPaidAmount;
    await party.save();

    res.json(toPurchaseResponse(invoice));
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Failed to create purchase invoice",
      error: err.message,
    });
  }
};

/* ================= GET ALL PURCHASES ================= */
exports.getPurchases = async (req, res) => {
  const query = { companyId: req.user.companyId };
  const dateRange = getDateRangeFromQuery(req.query);
  if (dateRange) {
    query.invoiceDate = { $gte: dateRange.fromDate, $lte: dateRange.toDate };
  }

  const data = await PurchaseInvoice.find(query)
    .populate("partyId", "name")
    .sort({ createdAt: -1 });

  res.json(data.map(toPurchaseResponse));
};

/* ================= GET PURCHASE BY ID ================= */
exports.getPurchaseById = async (req, res) => {
  const invoice = await PurchaseInvoice.findById(req.params.id)
    .populate("partyId", "name")
    .populate("items.productId", "name");

  res.json(toPurchaseResponse(invoice));
};

/* ================= UPDATE PURCHASE INVOICE ================= */
exports.updatePurchaseInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      partyId: bodyPartyId,
      supplierId,
      items,
      tax = 0,
      paidAmount = 0,
      invoiceDate,
    } = req.body;
    const partyId = bodyPartyId || supplierId;

    const invoice = await PurchaseInvoice.findById(id);

    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    /* ❌ ALLOW EDIT ONLY SAME DAY */
    const today = new Date().toISOString().slice(0, 10);
    const invoiceDay = new Date(invoice.invoiceDate).toISOString().slice(0, 10);

    if (today !== invoiceDay) {
      return res.status(400).json({
        message: "Invoice can only be edited on the same day",
      });
    }

    /* ================= REVERSE OLD DATA ================= */

    // Reverse old party balance
    const oldParty = await Party.findById(invoice.partyId);
    if (oldParty) {
      oldParty.balance -= invoice.totalAmount - invoice.paidAmount;
      await oldParty.save();
    }

    // Delete old stock
    await StockLedger.deleteMany({
      referenceId: invoice._id,
      referenceType: "PURCHASE_INVOICE",
    });

    // Delete old payments
    await Payment.deleteMany({
      invoiceId: invoice._id,
      invoiceType: "PURCHASE",
    });

    /* ================= RECALCULATE ================= */

    let subtotal = 0;
    items.forEach((i) => {
      if (!i.productId || !i.quantity || !i.rate) {
        throw new Error("Invalid item data");
      }
      i.amount = i.quantity * i.rate;
      subtotal += i.amount;
    });

    const totalAmount = subtotal + tax;

    if (paidAmount > totalAmount) {
      return res.status(400).json({
        message: "Paid amount cannot exceed invoice total",
      });
    }

    invoice.partyId = partyId;
    invoice.items = items;
    invoice.subtotal = subtotal;
    invoice.tax = tax;
    invoice.totalAmount = totalAmount;
    invoice.invoiceDate = invoiceDate;

    /* ================= ADD STOCK AGAIN ================= */
    for (const item of items) {
      await StockLedger.create({
        companyId: req.user.companyId,
        productId: item.productId,
        type: "PURCHASE",
        quantity: item.quantity,
        rate: item.rate,
        referenceType: "PURCHASE_INVOICE",
        referenceId: invoice._id,
      });
    }

    /* ================= HANDLE PAYMENT ================= */

    let finalPaidAmount = 0;

    if (paidAmount > 0) {
      await Payment.create({
        companyId: req.user.companyId,
        partyId,
        invoiceType: "PURCHASE",
        invoiceId: invoice._id,
        amount: paidAmount,
        paymentMode: "CASH",
        remarks: "Payment updated during invoice edit",
      });

      finalPaidAmount = paidAmount;
    }

    invoice.paidAmount = finalPaidAmount;
    invoice.status =
      finalPaidAmount === totalAmount
        ? "PAID"
        : finalPaidAmount > 0
          ? "PARTIAL"
          : "DUE";

    await invoice.save();

    /* ================= UPDATE PARTY BALANCE AGAIN ================= */

    const newParty = await Party.findById(partyId);
    if (newParty) {
      newParty.balance =
        (newParty.balance || 0) + (totalAmount - finalPaidAmount);
      await newParty.save();
    }

    res.json(toPurchaseResponse(invoice));
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Failed to update purchase invoice",
      error: err.message,
    });
  }
};
