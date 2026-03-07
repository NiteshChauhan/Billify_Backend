const StockLedger = require("../models/StockLedger");
const Product = require("../models/Product");
const Party = require("../models/Party");
const PurchaseInvoice = require("../models/PurchaseInvoice");
const SalesInvoice = require("../models/SalesInvoice");
const Payment = require("../models/Payment");
const { getDateRangeFromQuery } = require("../utils/dateRange");
const { getProfitSummary } = require("../utils/profitUtils");

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
              $cond: [
                {
                  $in: [
                    "$type",
                    ["PURCHASE", "OPENING", "ADJUSTMENT", "SALE_RETURN"],
                  ],
                },
                "$quantity",
                0,
              ],
            },
          },
          outQty: {
            $sum: {
              $cond: [
                { $in: ["$type", ["SALE", "PURCHASE_RETURN"]] },
                "$quantity",
                0,
              ],
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

/* ================= SUPPLIER DUE REPORT ================= */
exports.supplierDueReport = async (req, res) => {
  try {
    const suppliers = await Party.find({
      companyId: req.user.companyId,
      roles: "supplier",
    }).select("name balance");

    res.json(suppliers);
  } catch (err) {
    console.error("Supplier Due Error:", err);
    res.status(500).json({ error: "Failed to load supplier dues" });
  }
};

/* ================= VENDOR DUE REPORT ================= */
exports.vendorDueReport = async (req, res) => {
  try {
    const vendors = await Party.find({
      companyId: req.user.companyId,
      roles: "vendor",
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
    const query = { companyId: req.user.companyId };
    const range = getDateRangeFromQuery(req.query);
    if (range) {
      query.invoiceDate = { $gte: range.fromDate, $lte: range.toDate };
    }

    const data = await PurchaseInvoice.find(query)
      .populate("partyId", "name")
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
    const query = { companyId: req.user.companyId };
    const range = getDateRangeFromQuery(req.query);
    if (range) {
      query.invoiceDate = { $gte: range.fromDate, $lte: range.toDate };
    }

    const data = await SalesInvoice.find(query)
      .populate("partyId", "name")
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
    const range = getDateRangeFromQuery(req.query);

    const defaultFrom = new Date();
    defaultFrom.setHours(0, 0, 0, 0);
    const defaultTo = new Date();
    const fromDate = range?.fromDate || defaultFrom;
    const toDate = range?.toDate || defaultTo;
    const summary = await getProfitSummary(companyId, fromDate, toDate);

    res.json({
      totalSales: summary.sales,
      totalPurchase: summary.cost,
      profit: summary.profit,
      cost: summary.cost,
      daily: summary.daily || [],
    });
  } catch (err) {
    console.error("Profit Loss Error:", err);
    res.status(500).json({ error: "Failed to load profit & loss" });
  }
};

/* ================= PARTY LEDGER ================= */
exports.partyLedger = async (req, res) => {
  try {
    const { partyId } = req.params;
    const companyId = req.user.companyId;

    const purchaseInvoices = await PurchaseInvoice.find({
      partyId,
      companyId,
    }).sort({ invoiceDate: -1 });

    const salesInvoices = await SalesInvoice.find({
      partyId,
      companyId,
    }).sort({ invoiceDate: -1 });

    const payments = await Payment.find({
      partyId,
      companyId,
    }).sort({ createdAt: -1 });

    res.json({
      purchaseInvoices,
      salesInvoices,
      payments,
    });
  } catch (err) {
    console.error("Party Ledger Error:", err);
    res.status(500).json({ error: "Failed to load party ledger" });
  }
};
