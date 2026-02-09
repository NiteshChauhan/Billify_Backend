const StockLedger = require("../models/StockLedger");
const Product = require("../models/Product");
const Supplier = require("../models/Supplier");
const Vendor = require("../models/Vendor");
const PurchaseInvoice = require("../models/PurchaseInvoice");
const SalesInvoice = require("../models/SalesInvoice");
const Payment = require("../models/Payment");

/* ================= STOCK REPORT ================= */
exports.stockReport = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    const report = await StockLedger.aggregate([
      { $match: { companyId } },

      {
        $group: {
          _id: "$productId",
          inQty: {
            $sum: {
              $cond: [{ $eq: ["$type", "IN"] }, "$quantity", 0],
            },
          },
          outQty: {
            $sum: {
              $cond: [{ $eq: ["$type", "OUT"] }, "$quantity", 0],
            },
          },
        },
      },

      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "_id",
          as: "product",
        },
      },
      { $unwind: "$product" },

      {
        $project: {
          productName: "$product.name",
          purchasedQty: "$inQty",
          soldQty: "$outQty",
          currentStock: { $subtract: ["$inQty", "$outQty"] },
        },
      },
    ]);

    res.json(report);
  } catch (err) {
    console.error("Stock Report Error:", err);
    res.status(500).json({ error: "Failed to load stock report" });
  }
};

/* ================= SUPPLIER DUE ================= */
exports.supplierDueReport = async (req, res) => {
  try {
    const suppliers = await Supplier.find({
      companyId: req.user.companyId,
    }).select("name balance");

    res.json(suppliers);
  } catch (err) {
    console.error("Supplier Due Error:", err);
    res.status(500).json({ error: "Failed to load supplier dues" });
  }
};

/* ================= VENDOR DUE ================= */
exports.vendorDueReport = async (req, res) => {
  try {
    const vendors = await Vendor.find({
      companyId: req.user.companyId,
    }).select("name balance");

    res.json(vendors);
  } catch (err) {
    console.error("Vendor Due Error:", err);
    res.status(500).json({ error: "Failed to load vendor dues" });
  }
};

/* ================= PURCHASE REPORT ================= */
exports.purchaseReport = async (req, res) => {
  try {
    const { from, to } = req.query;

    const data = await PurchaseInvoice.find({
      companyId: req.user.companyId,
      invoiceDate: {
        $gte: new Date(from),
        $lte: new Date(to),
      },
    })
      .populate("supplierId", "name")
      .sort({ invoiceDate: -1 });

    res.json(data);
  } catch (err) {
    console.error("Purchase Report Error:", err);
    res.status(500).json({ error: "Failed to load purchase report" });
  }
};

/* ================= SALES REPORT ================= */
exports.salesReport = async (req, res) => {
  try {
    const { from, to } = req.query;

    const data = await SalesInvoice.find({
      companyId: req.user.companyId,
      invoiceDate: {
        $gte: new Date(from),
        $lte: new Date(to),
      },
    })
      .populate("vendorId", "name")
      .sort({ invoiceDate: -1 });

    res.json(data);
  } catch (err) {
    console.error("Sales Report Error:", err);
    res.status(500).json({ error: "Failed to load sales report" });
  }
};

/* ================= PROFIT & LOSS ================= */
exports.profitLossReport = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    const sales = await SalesInvoice.aggregate([
      { $match: { companyId } },
      { $group: { _id: null, totalSales: { $sum: "$totalAmount" } } },
    ]);

    const purchases = await PurchaseInvoice.aggregate([
      { $match: { companyId } },
      { $group: { _id: null, totalPurchase: { $sum: "$totalAmount" } } },
    ]);

    const totalSales = sales[0]?.totalSales || 0;
    const totalPurchase = purchases[0]?.totalPurchase || 0;

    res.json({
      totalSales,
      totalPurchase,
      profit: totalSales - totalPurchase,
    });
  } catch (err) {
    console.error("Profit Loss Error:", err);
    res.status(500).json({ error: "Failed to load profit & loss" });
  }
};

/* ================= PARTY LEDGER ================= */
exports.partyLedger = async (req, res) => {
  try {
    const { partyType, partyId } = req.params;

    const invoices =
      partyType === "SUPPLIER"
        ? await PurchaseInvoice.find({ supplierId: partyId })
        : await SalesInvoice.find({ vendorId: partyId });

    const payments = await Payment.find({ partyType, partyId });

    res.json({ invoices, payments });
  } catch (err) {
    console.error("Party Ledger Error:", err);
    res.status(500).json({ error: "Failed to load party ledger" });
  }
};
