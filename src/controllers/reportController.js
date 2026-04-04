const StockLedger = require("../models/StockLedger");
const Product = require("../models/Product");
const Party = require("../models/Party");
const PurchaseInvoice = require("../models/PurchaseInvoice");
const SalesInvoice = require("../models/SalesInvoice");
const Payment = require("../models/Payment");
const CompanyBalance = require("../models/CompanyBalance");
const Expense = require("../models/Expense");
const { getDateRangeFromQuery } = require("../utils/dateRange");
const { getProfitSummary } = require("../utils/profitUtils");

const startOfDay = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfDay = (value) => {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
};

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

/* ================= DAILY REPORT / DAY BOOK ================= */
exports.dailyReport = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const requestedDate = req.query.date || new Date().toISOString().slice(0, 10);
    const selectedDate = new Date(requestedDate);

    if (Number.isNaN(selectedDate.getTime())) {
      return res.status(400).json({ error: "Invalid date" });
    }

    const paymentTypeFilter = String(req.query.paymentType || "all").toLowerCase();
    const billTypeFilter = String(req.query.type || "all").toLowerCase();
    const search = String(req.query.search || "").trim().toLowerCase();
    const validPaymentTypes = ["all", "cash", "bank"];
    const validBillTypes = ["all", "sale", "purchase"];

    if (!validPaymentTypes.includes(paymentTypeFilter)) {
      return res.status(400).json({ error: "Invalid paymentType" });
    }

    if (!validBillTypes.includes(billTypeFilter)) {
      return res.status(400).json({ error: "Invalid type" });
    }

    const dayStart = startOfDay(selectedDate);
    const dayEnd = endOfDay(selectedDate);

    const dailyInvoiceQuery = {
      companyId,
      paymentType: paymentTypeFilter === "all" ? { $in: ["cash", "bank"] } : paymentTypeFilter,
      invoiceDate: { $gte: dayStart, $lte: dayEnd },
    };

    const previousInvoiceQuery = {
      companyId,
      paymentType: paymentTypeFilter === "all" ? { $in: ["cash", "bank"] } : paymentTypeFilter,
      invoiceDate: { $lt: dayStart },
    };

    const [sales, purchases, previousSales, previousPurchases] = await Promise.all([
      SalesInvoice.find(
        billTypeFilter === "purchase" ? { _id: null } : dailyInvoiceQuery,
      )
        .populate("partyId", "name")
        .populate("bankAccountId", "accountName")
        .sort({ invoiceDate: 1, createdAt: 1 }),
      PurchaseInvoice.find(
        billTypeFilter === "sale" ? { _id: null } : dailyInvoiceQuery,
      )
        .populate("partyId", "name")
        .populate("bankAccountId", "accountName")
        .sort({ invoiceDate: 1, createdAt: 1 }),
      SalesInvoice.find(previousInvoiceQuery).select("totalAmount"),
      PurchaseInvoice.find(previousInvoiceQuery).select("totalAmount"),
    ]);

    const expenses = await Expense.find({
      companyId,
      date: { $gte: dayStart, $lte: dayEnd },
      ...(paymentTypeFilter === "all" ? {} : { paymentType: paymentTypeFilter }),
    })
      .populate("bankAccountId", "accountName")
      .sort({ date: 1, createdAt: 1 });

    const manualOpening = await CompanyBalance.findOne({
      companyId,
      date: dayStart,
    });

    const matchesSearch = (partyName) => {
      if (!search) return true;
      return String(partyName || "cash").toLowerCase().includes(search);
    };

    const rows = [
      ...sales.map((invoice) => ({
        date: invoice.invoiceDate,
        type: "sale",
        partyName: invoice.partyId?.name || "Cash",
        paymentType: String(invoice.paymentType || "cash").toLowerCase(),
        amount: Number(invoice.totalAmount || 0),
        billId: invoice._id,
        bankAccountId: invoice.bankAccountId?._id || invoice.bankAccountId || null,
        bankAccountName: invoice.bankAccountId?.accountName || "-",
      })),
      ...purchases.map((invoice) => ({
        date: invoice.invoiceDate,
        type: "purchase",
        partyName: invoice.partyId?.name || "Cash",
        paymentType: String(invoice.paymentType || "cash").toLowerCase(),
        amount: Number(invoice.totalAmount || 0),
        billId: invoice._id,
        bankAccountId: invoice.bankAccountId?._id || invoice.bankAccountId || null,
        bankAccountName: invoice.bankAccountId?.accountName || "-",
      })),
      ...expenses.map((expense) => ({
        date: expense.date,
        type: "expense",
        partyName: String(expense.title || "").trim() || "Expense",
        paymentType: String(expense.paymentType || "cash").toLowerCase(),
        amount: Number(expense.amount || 0),
        billId: expense._id,
        bankAccountId: expense.bankAccountId?._id || expense.bankAccountId || null,
        note: expense.note || "",
        bankAccountName: expense.bankAccountId?.accountName || "-",
      })),
    ]
      .filter((row) => matchesSearch(row.partyName))
      .filter((row) => billTypeFilter === "all" || row.type === billTypeFilter)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    const previousSalesTotal = previousSales.reduce((sum, row) => sum + Number(row.totalAmount || 0), 0);
    const previousPurchaseTotal = previousPurchases.reduce((sum, row) => sum + Number(row.totalAmount || 0), 0);
    const previousExpenseTotal = await Expense.aggregate([
      {
        $match: {
          companyId,
          date: { $lt: dayStart },
          ...(paymentTypeFilter === "all" ? {} : { paymentType: paymentTypeFilter }),
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const openingBalance =
      manualOpening?.openingBalance ??
      (previousSalesTotal - previousPurchaseTotal - Number(previousExpenseTotal[0]?.total || 0));

    const totalSales = rows
      .filter((row) => row.type === "sale")
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const totalPurchase = rows
      .filter((row) => row.type === "purchase")
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const totalExpenses = rows
      .filter((row) => row.type === "expense")
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const closingBalance = openingBalance + totalSales - totalPurchase - totalExpenses;

    res.json({
      rows,
      summary: {
        openingBalance,
        totalSales,
        totalPurchase,
        totalExpenses,
        closingBalance,
        isManualOpeningBalance: Boolean(manualOpening),
      },
    });
  } catch (err) {
    console.error("Daily Report Error:", err);
    res.status(500).json({ error: "Failed to load daily report" });
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
