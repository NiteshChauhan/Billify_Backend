const SalesInvoice = require("../models/SalesInvoice");
const StockLedger = require("../models/StockLedger");
const Party = require("../models/Party");
const { validateStockForSale } = require("../utils/stockValidation");
const { getDateRangeFromQuery } = require("../utils/dateRange");

const toSalesResponse = (invoiceDoc) => {
  const invoice = invoiceDoc.toObject ? invoiceDoc.toObject() : invoiceDoc;
  return {
    ...invoice,
    vendorId: invoice.partyId,
    customerId: invoice.partyId,
  };
};

/* ================= CREATE SALES INVOICE ================= */
exports.createSalesInvoice = async (req, res) => {
  try {
    const {
      partyId: bodyPartyId,
      vendorId,
      customerId,
      items,
      tax = 0,
      paidAmount = 0,
      invoiceDate,
    } = req.body;
    const partyId = bodyPartyId || customerId || vendorId;

    if (!partyId || !items || items.length === 0) {
      return res.status(400).json({ message: "Customer & items required" });
    }

    /* 🔎 Validate Party is Vendor (Customer) */
    const party = await Party.findOne({
      _id: partyId,
      companyId: req.user.companyId,
      roles: { $in: ["customer", "vendor"] },
    });

    if (!party) {
      return res.status(400).json({
        message: "Invalid customer party",
      });
    }

    // 1️⃣ Validate stock
    await validateStockForSale(req.user.companyId, items);

    // 2️⃣ Calculate totals
    let subtotal = 0;
    items.forEach((i) => {
      if (!i.productId || !i.quantity || !i.rate) {
        throw new Error("Invalid item");
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

    // 3️⃣ Auto Invoice No
    const count = await SalesInvoice.countDocuments({
      companyId: req.user.companyId,
    });

    const invoiceNo = `SAL-${count + 1}`;

    // 4️⃣ Create invoice
    const invoice = await SalesInvoice.create({
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

    // 5️⃣ Stock Ledger (SALE)
    for (const item of items) {
      await StockLedger.create({
        companyId: req.user.companyId,
        productId: item.productId,
        type: "SALE",
        quantity: item.quantity,
        rate: item.rate,
        referenceType: "SALES_INVOICE",
        referenceId: invoice._id,
      });
    }

    /* ================= HANDLE INITIAL PAYMENT ================= */
    let finalPaidAmount = 0;

    if (paidAmount > 0) {
      finalPaidAmount = paidAmount;
    }

    invoice.paidAmount = finalPaidAmount;
    invoice.status =
      finalPaidAmount >= totalAmount
        ? "PAID"
        : finalPaidAmount > 0
          ? "PARTIAL"
          : "DUE";

    await invoice.save();

    /* ================= UPDATE PARTY BALANCE ================= */
    party.balance = party.balance || 0;
    party.balance += totalAmount - finalPaidAmount;
    await party.save();

    res.json(toSalesResponse(invoice));
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
};

/* ================= GET SALES LIST ================= */
exports.getSales = async (req, res) => {
  const query = { companyId: req.user.companyId };
  const dateRange = getDateRangeFromQuery(req.query);
  if (dateRange) {
    query.invoiceDate = { $gte: dateRange.fromDate, $lte: dateRange.toDate };
  }

  const data = await SalesInvoice.find(query)
    .populate("partyId", "name")
    .sort({ createdAt: -1 });

  res.json(data.map(toSalesResponse));
};

/* ================= GET SALES BY ID ================= */
exports.getSalesById = async (req, res) => {
  const invoice = await SalesInvoice.findById(req.params.id)
    .populate("partyId", "name")
    .populate("items.productId", "name");

  res.json(toSalesResponse(invoice));
};

/* ================= UPDATE SALES INVOICE ================= */
exports.updateSalesInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      partyId: bodyPartyId,
      vendorId,
      customerId,
      items,
      tax = 0,
      paidAmount = 0,
      invoiceDate,
    } = req.body;
    const partyId = bodyPartyId || customerId || vendorId;

    const invoice = await SalesInvoice.findById(id);

    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    /* ❌ ALLOW EDIT ONLY SAME DAY */
    const today = new Date().toISOString().slice(0, 10);
    const invoiceDay = new Date(invoice.invoiceDate).toISOString().slice(0, 10);

    if (today !== invoiceDay) {
      return res.status(400).json({
        message: "Sales invoice can only be edited on the same day",
      });
    }

    /* ================= REVERSE OLD DATA ================= */

    // Reverse old party balance
    const oldParty = await Party.findById(invoice.partyId);
    if (oldParty) {
      oldParty.balance -= invoice.totalAmount - invoice.paidAmount;
      await oldParty.save();
    }

    // Remove old stock ledger SALE entries
    await StockLedger.deleteMany({
      referenceId: invoice._id,
      referenceType: "SALES_INVOICE",
    });

    /* ================= VALIDATE STOCK AGAIN ================= */
    await validateStockForSale(req.user.companyId, items);

    /* ================= RECALCULATE ================= */
    let subtotal = 0;

    items.forEach((i) => {
      if (!i.productId || !i.quantity || !i.rate) {
        throw new Error("Invalid item");
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

    /* ================= UPDATE INVOICE ================= */

    invoice.partyId = partyId;
    invoice.items = items;
    invoice.subtotal = subtotal;
    invoice.tax = tax;
    invoice.totalAmount = totalAmount;
    invoice.invoiceDate = invoiceDate;

    invoice.paidAmount = paidAmount;
    invoice.status =
      paidAmount >= totalAmount ? "PAID" : paidAmount > 0 ? "PARTIAL" : "DUE";

    await invoice.save();

    /* ================= ADD STOCK LEDGER AGAIN ================= */

    for (const item of items) {
      await StockLedger.create({
        companyId: req.user.companyId,
        productId: item.productId,
        type: "SALE",
        quantity: item.quantity,
        rate: item.rate,
        referenceType: "SALES_INVOICE",
        referenceId: invoice._id,
      });
    }

    /* ================= UPDATE PARTY BALANCE AGAIN ================= */

    const newParty = await Party.findById(partyId);
    if (newParty) {
      newParty.balance = (newParty.balance || 0) + (totalAmount - paidAmount);
      await newParty.save();
    }

    res.json(toSalesResponse(invoice));
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Failed to update sales invoice",
      error: err.message,
    });
  }
};
