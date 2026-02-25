const PurchaseInvoice = require("../models/PurchaseInvoice");
const StockLedger = require("../models/StockLedger");
const Supplier = require("../models/Supplier");
const Payment = require("../models/Payment");

/* ================= CREATE PURCHASE INVOICE ================= */
exports.createPurchaseInvoice = async (req, res) => {
  try {
    const {
      supplierId,
      items,
      tax = 0,
      paidAmount = 0,
      invoiceDate
    } = req.body;

    if (!supplierId || !items || items.length === 0) {
      return res.status(400).json({
        message: "Supplier and items are required"
      });
    }

    let subtotal = 0;
    items.forEach(i => {
      if (!i.productId || !i.quantity || !i.rate) {
        throw new Error("Invalid item data");
      }
      i.amount = i.quantity * i.rate;
      subtotal += i.amount;
    });

    const totalAmount = subtotal + tax;

    if (paidAmount > totalAmount) {
      return res.status(400).json({
        message: "Paid amount cannot exceed invoice total"
      });
    }

    /* 🔢 AUTO INVOICE NUMBER */
    const count = await PurchaseInvoice.countDocuments({
      companyId: req.user.companyId
    });

    const invoiceNo = `PUR-${count + 1}`;

    /* ✅ CREATE INVOICE (paidAmount ALWAYS starts from 0) */
    const invoice = await PurchaseInvoice.create({
      companyId: req.user.companyId,
      supplierId,
      invoiceNo,
      invoiceDate,
      items,
      subtotal,
      tax,
      totalAmount,
      paidAmount: 0,
      status: "DUE"
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
        referenceId: invoice._id
      });
    }

    /* ================= HANDLE INITIAL PAYMENT ================= */
    let finalPaidAmount = 0;

    if (paidAmount > 0) {
      /* 🔹 Create payment entry */
      await Payment.create({
        companyId: req.user.companyId,
        partyType: "SUPPLIER",
        partyId: supplierId,
        invoiceType: "PURCHASE",
        invoiceId: invoice._id,
        amount: paidAmount,
        paymentMode: "CASH",
        remarks: "Payment at invoice creation"
      });

      finalPaidAmount = paidAmount;
    }

    /* 🔄 UPDATE INVOICE PAID + STATUS */
    invoice.paidAmount = finalPaidAmount;
    invoice.status =
      finalPaidAmount === totalAmount
        ? "PAID"
        : finalPaidAmount > 0
        ? "PARTIAL"
        : "DUE";

    await invoice.save();

    /* 💰 UPDATE SUPPLIER BALANCE */
    const supplier = await Supplier.findById(supplierId);
    supplier.balance = supplier.balance || 0;
    supplier.balance += totalAmount - finalPaidAmount;
    await supplier.save();

    res.json(invoice);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Failed to create purchase invoice",
      error: err.message
    });
  }
};

/* ================= GET ALL PURCHASES ================= */
exports.getPurchases = async (req, res) => {
  const data = await PurchaseInvoice
    .find({ companyId: req.user.companyId })
    .populate("supplierId", "name")
    .sort({ createdAt: -1 });

  res.json(data);
};

/* ================= GET PURCHASE BY ID ================= */
exports.getPurchaseById = async (req, res) => {
  const invoice = await PurchaseInvoice
    .findById(req.params.id)
    .populate("supplierId", "name")
    .populate("items.productId", "name");

  res.json(invoice);
};


/* ================= UPDATE PURCHASE INVOICE ================= */
exports.updatePurchaseInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      supplierId,
      items,
      tax = 0,
      paidAmount = 0,
      invoiceDate
    } = req.body;

    const invoice = await PurchaseInvoice.findById(id);

    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    /* ❌ ALLOW EDIT ONLY SAME DAY */
    const today = new Date().toISOString().slice(0, 10);
    const invoiceDay = new Date(invoice.invoiceDate)
      .toISOString()
      .slice(0, 10);

    if (today !== invoiceDay) {
      return res.status(400).json({
        message: "Invoice can only be edited on the same day"
      });
    }

    /* ================= REVERSE OLD DATA ================= */

    // 1️⃣ Reverse supplier balance
    const oldSupplier = await Supplier.findById(invoice.supplierId);
    oldSupplier.balance -= (invoice.totalAmount - invoice.paidAmount);
    await oldSupplier.save();

    // 2️⃣ Delete old stock ledger entries
    await StockLedger.deleteMany({
      referenceId: invoice._id,
      referenceType: "PURCHASE_INVOICE"
    });

    // 3️⃣ Delete old payments
    await Payment.deleteMany({
      invoiceId: invoice._id,
      invoiceType: "PURCHASE"
    });

    /* ================= RECALCULATE NEW DATA ================= */

    let subtotal = 0;
    items.forEach(i => {
      if (!i.productId || !i.quantity || !i.rate) {
        throw new Error("Invalid item data");
      }
      i.amount = i.quantity * i.rate;
      subtotal += i.amount;
    });

    const totalAmount = subtotal + tax;

    if (paidAmount > totalAmount) {
      return res.status(400).json({
        message: "Paid amount cannot exceed invoice total"
      });
    }

    /* ================= UPDATE INVOICE ================= */

    invoice.supplierId = supplierId;
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
        referenceId: invoice._id
      });
    }

    /* ================= HANDLE PAYMENT ================= */

    let finalPaidAmount = 0;

    if (paidAmount > 0) {
      await Payment.create({
        companyId: req.user.companyId,
        partyType: "SUPPLIER",
        partyId: supplierId,
        invoiceType: "PURCHASE",
        invoiceId: invoice._id,
        amount: paidAmount,
        paymentMode: "CASH",
        remarks: "Payment updated during invoice edit"
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

    /* ================= UPDATE SUPPLIER BALANCE AGAIN ================= */

    const newSupplier = await Supplier.findById(supplierId);
    newSupplier.balance =
      (newSupplier.balance || 0) + (totalAmount - finalPaidAmount);

    await newSupplier.save();

    res.json(invoice);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Failed to update purchase invoice",
      error: err.message
    });
  }
};