const SalesInvoice = require("../models/SalesInvoice");
const StockLedger = require("../models/StockLedger");
const Vendor = require("../models/Vendor");
const { validateStockForSale } = require("../utils/stockValidation");

/* ================= CREATE SALES INVOICE ================= */
exports.createSalesInvoice = async (req, res) => {
  try {
    const { vendorId, items, tax = 0, paidAmount = 0, invoiceDate } = req.body;

    if (!vendorId || !items || items.length === 0) {
      return res.status(400).json({ message: "Vendor & items required" });
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

    // 3️⃣ Auto Invoice No
    const count = await SalesInvoice.countDocuments({
      companyId: req.user.companyId,
    });
    const invoiceNo = `SAL-${count + 1}`;

    // 4️⃣ Create invoice
    const invoice = await SalesInvoice.create({
      companyId: req.user.companyId,
      vendorId,
      invoiceNo,
      invoiceDate,
      items,
      subtotal,
      tax,
      totalAmount,
      paidAmount,
      status:
        paidAmount >= totalAmount ? "PAID" : paidAmount > 0 ? "PARTIAL" : "DUE",
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

    // 6️⃣ Update vendor balance
    const vendor = await Vendor.findById(vendorId);
    vendor.balance += totalAmount - paidAmount;
    await vendor.save();

    res.json(invoice);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/* ================= GET SALES LIST ================= */
exports.getSales = async (req, res) => {
  const data = await SalesInvoice.find({ companyId: req.user.companyId })
    .populate("vendorId", "name")
    .sort({ createdAt: -1 });

  res.json(data);
};

/* ================= GET SALES BY ID ================= */
exports.getSalesById = async (req, res) => {
  const invoice = await SalesInvoice.findById(req.params.id)
    .populate("vendorId", "name")
    .populate("items.productId", "name");

  res.json(invoice);
};


/* ================= UPDATE SALES INVOICE ================= */
exports.updateSalesInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const { vendorId, items, tax = 0, paidAmount = 0, invoiceDate } = req.body;

    const invoice = await SalesInvoice.findById(id);

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
        message: "Sales invoice can only be edited on the same day",
      });
    }

    /* ================= REVERSE OLD DATA ================= */

    // 1️⃣ Reverse Vendor Balance
    const oldVendor = await Vendor.findById(invoice.vendorId);
    oldVendor.balance -= (invoice.totalAmount - invoice.paidAmount);
    await oldVendor.save();

    // 2️⃣ Remove old stock ledger SALE entries
    await StockLedger.deleteMany({
      referenceId: invoice._id,
      referenceType: "SALES_INVOICE",
    });

    /* ================= VALIDATE STOCK AGAIN ================= */
    // Important: After reversing stock, now validate new items
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

    invoice.vendorId = vendorId;
    invoice.items = items;
    invoice.subtotal = subtotal;
    invoice.tax = tax;
    invoice.totalAmount = totalAmount;
    invoice.invoiceDate = invoiceDate;

    invoice.paidAmount = paidAmount;
    invoice.status =
      paidAmount >= totalAmount
        ? "PAID"
        : paidAmount > 0
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

    /* ================= UPDATE VENDOR BALANCE AGAIN ================= */

    const newVendor = await Vendor.findById(vendorId);
    newVendor.balance += totalAmount - paidAmount;
    await newVendor.save();

    res.json(invoice);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Failed to update sales invoice",
      error: err.message,
    });
  }
};