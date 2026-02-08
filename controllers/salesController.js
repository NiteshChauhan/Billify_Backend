import SalesInvoice from "@/models/SalesInvoice";
import StockLedger from "@/models/StockLedger";
import Vendor from "@/models/Vendor";
import { validateStockForSale } from "@/utils/stockValidation";

/* ================= CREATE SALES INVOICE ================= */
export const createSalesInvoice = async (req, res) => {
  try {
    const { vendorId, items, tax = 0, paidAmount = 0, invoiceDate } = req.body;

    if (!vendorId || !items || items.length === 0) {
      return res.status(400).json({
        message: "Vendor & items required",
      });
    }

    /* 🔒 STOCK VALIDATION */
    await validateStockForSale(req.user.companyId, items);

    /* 🔢 CALCULATE TOTAL */
    let subtotal = 0;
    items.forEach((i) => {
      if (!i.productId || !i.quantity || !i.rate) {
        throw new Error("Invalid item");
      }
      i.amount = i.quantity * i.rate;
      subtotal += i.amount;
    });

    const totalAmount = subtotal + tax;

    /* 🔢 AUTO INVOICE NO */
    const count = await SalesInvoice.countDocuments({
      companyId: req.user.companyId,
    });
    const invoiceNo = `SAL-${count + 1}`;

    /* 🧾 CREATE INVOICE */
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

    /* 📦 STOCK LEDGER (SALE) */
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

    /* 💰 UPDATE VENDOR BALANCE */
    const vendor = await Vendor.findById(vendorId);
    vendor.balance = (vendor.balance || 0) + (totalAmount - paidAmount);
    await vendor.save();

    res.json(invoice);
  } catch (err) {
    console.error("Sales Error:", err);
    res.status(400).json({ error: err.message });
  }
};

/* ================= GET SALES LIST ================= */
export const getSales = async (req, res) => {
  const data = await SalesInvoice.find({
    companyId: req.user.companyId,
  })
    .populate("vendorId", "name")
    .sort({ createdAt: -1 });

  res.json(data);
};

/* ================= GET SALES BY ID ================= */
export const getSalesById = async (req, res) => {
  const invoice = await SalesInvoice.findById(req.query.id)
    .populate("vendorId", "name")
    .populate("items.productId", "name");

  res.json(invoice);
};
