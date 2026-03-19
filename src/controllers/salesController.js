const SalesInvoice = require("../models/SalesInvoice");
const StockLedger = require("../models/StockLedger");
const Party = require("../models/Party");
const Payment = require("../models/Payment");
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
      paymentType: bodyPaymentType,
      items,
      tax = 0,
      paidAmount = 0,
      invoiceDate,
    } = req.body;
    const partyId = bodyPartyId || customerId || vendorId;

    const paymentType = String(bodyPaymentType || "credit").toLowerCase();
    const isCredit = paymentType === "credit";
    const isCashOrBank = paymentType === "cash" || paymentType === "bank";

    if ((!partyId && isCredit) || !items || items.length === 0) {
      return res.status(400).json({ message: "Customer & items required" });
    }

    /* 🔎 Validate Party is Vendor (Customer) */
    if (!isCredit && !isCashOrBank) {
      return res.status(400).json({ message: "Invalid paymentType" });
    }

    let party = null;
    if (partyId) {
      party = await Party.findOne({
        _id: partyId,
        companyId: req.user.companyId,
        roles: { $in: ["customer", "vendor"] },
      });

      if (!party) {
        return res.status(400).json({
          message: "Invalid customer party",
        });
      }
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

    const requestedPaid = Number(paidAmount || 0);
    if (requestedPaid > totalAmount) {
      return res.status(400).json({
        message: "Paid amount cannot exceed invoice total",
      });
    }

    const finalPaidAmount = isCredit ? requestedPaid : totalAmount;

    // 3️⃣ Auto Invoice No
    const count = await SalesInvoice.countDocuments({
      companyId: req.user.companyId,
    });

    const invoiceNo = `SAL-${count + 1}`;

    // 4️⃣ Create invoice
    const invoice = await SalesInvoice.create({
      companyId: req.user.companyId,
      partyId: partyId || undefined,
      paymentType,
      invoiceNo,
      invoiceDate,
      items,
      subtotal,
      tax,
      totalAmount,
      paidAmount: finalPaidAmount,
      status:
        finalPaidAmount >= totalAmount
          ? "PAID"
          : finalPaidAmount > 0
            ? "PARTIAL"
            : "DUE",
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

    /* ================= UPDATE PARTY BALANCE ================= */
    if (party) {
      party.balance = party.balance || 0;
      party.balance += totalAmount - finalPaidAmount;
      await party.save();
    }

    /* ================= CREATE INITIAL PAYMENT ENTRY (IF ANY) ================= */
    if (finalPaidAmount > 0) {
      await Payment.create({
        companyId: req.user.companyId,
        partyId: party ? party._id : undefined,
        invoiceType: "SALE",
        invoiceId: invoice._id,
        paymentType: "RECEIVED",
        amount: finalPaidAmount,
        paymentMode: paymentType === "bank" ? "BANK" : "CASH",
        remarks: party ? "Payment at invoice creation" : "Walk-in payment at invoice creation",
        paymentDate: invoice.invoiceDate || new Date(),
      });
    }

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
  if (req.query.paymentType) {
    query.paymentType = String(req.query.paymentType).toLowerCase();
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
      paymentType: bodyPaymentType,
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

    const paymentType = String(bodyPaymentType || invoice.paymentType || "credit").toLowerCase();
    const isCredit = paymentType === "credit";
    const isCashOrBank = paymentType === "cash" || paymentType === "bank";

    /* ❌ ALLOW EDIT ONLY SAME DAY */
    const today = new Date().toISOString().slice(0, 10);
    const invoiceDay = new Date(invoice.invoiceDate).toISOString().slice(0, 10);

    if (today !== invoiceDay) {
      return res.status(400).json({
        message: "Sales invoice can only be edited on the same day",
      });
    }

    if (!isCredit && !isCashOrBank) {
      return res.status(400).json({ message: "Invalid paymentType" });
    }

    if (!partyId && isCredit) {
      return res.status(400).json({ message: "Customer is required for credit invoices" });
    }

    /* ================= REVERSE OLD DATA ================= */

    // Reverse old party balance
    const oldParty = invoice.partyId ? await Party.findById(invoice.partyId) : null;
    if (oldParty) {
      oldParty.balance -= invoice.totalAmount - invoice.paidAmount;
      await oldParty.save();
    }

    // Remove old stock ledger SALE entries
    await StockLedger.deleteMany({
      referenceId: invoice._id,
      referenceType: "SALES_INVOICE",
    });

    await Payment.deleteMany({
      companyId: req.user.companyId,
      invoiceId: invoice._id,
      invoiceType: "SALE",
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

    const requestedPaid = Number(paidAmount || 0);
    if (requestedPaid > totalAmount) {
      return res.status(400).json({
        message: "Paid amount cannot exceed invoice total",
      });
    }

    const finalPaidAmount = isCredit ? requestedPaid : totalAmount;

    /* ================= UPDATE INVOICE ================= */
    let newParty = null;
    if (partyId) {
      newParty = await Party.findOne({
        _id: partyId,
        companyId: req.user.companyId,
        roles: { $in: ["customer", "vendor"] },
      });
      if (!newParty) {
        return res.status(400).json({ message: "Invalid customer party" });
      }
    }

    invoice.partyId = partyId || undefined;
    invoice.paymentType = paymentType;
    invoice.items = items;
    invoice.subtotal = subtotal;
    invoice.tax = tax;
    invoice.totalAmount = totalAmount;
    invoice.invoiceDate = invoiceDate;

    invoice.paidAmount = finalPaidAmount;
    invoice.status =
      finalPaidAmount >= totalAmount
        ? "PAID"
        : finalPaidAmount > 0
          ? "PARTIAL"
          : "DUE";

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
    if (newParty) {
      newParty.balance = (newParty.balance || 0) + (totalAmount - finalPaidAmount);
      await newParty.save();
    }

    if (finalPaidAmount > 0) {
      await Payment.create({
        companyId: req.user.companyId,
        partyId: newParty ? newParty._id : undefined,
        invoiceType: "SALE",
        invoiceId: invoice._id,
        paymentType: "RECEIVED",
        amount: finalPaidAmount,
        paymentMode: paymentType === "bank" ? "BANK" : "CASH",
        remarks: newParty ? "Payment updated during invoice edit" : "Walk-in payment updated during invoice edit",
        paymentDate: invoice.invoiceDate || new Date(),
      });
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
