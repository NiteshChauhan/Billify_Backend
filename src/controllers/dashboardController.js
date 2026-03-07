const SalesInvoice = require("../models/SalesInvoice");
const PurchaseInvoice = require("../models/PurchaseInvoice");
const Payment = require("../models/Payment");
const Product = require("../models/Product");
const { getDateRangeFromQuery } = require("../utils/dateRange");

exports.getDashboardSummary = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const range = getDateRangeFromQuery(req.query);
    const dateFilter = range
      ? { invoiceDate: { $gte: range.fromDate, $lte: range.toDate } }
      : {};

    const [salesAgg] = await SalesInvoice.aggregate([
      { $match: { companyId, ...dateFilter } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]);

    const [purchaseAgg] = await PurchaseInvoice.aggregate([
      { $match: { companyId, ...dateFilter } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]);

    const [paymentAgg] = await Payment.aggregate([
      {
        $match: {
          companyId,
          invoiceType: "SALE",
          ...(range
            ? { paymentDate: { $gte: range.fromDate, $lte: range.toDate } }
            : {}),
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const totalProducts = await Product.countDocuments({ companyId });

    const year = new Date().getFullYear();
    const start = new Date(`${year}-01-01`);
    const end = new Date(`${year}-12-31`);

    const salesMonthly = await SalesInvoice.aggregate([
      {
        $match: {
          companyId,
          invoiceDate: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: { $month: "$invoiceDate" },
          total: { $sum: "$totalAmount" },
        },
      },
    ]);

    const purchaseMonthly = await PurchaseInvoice.aggregate([
      {
        $match: {
          companyId,
          invoiceDate: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: { $month: "$invoiceDate" },
          total: { $sum: "$totalAmount" },
        },
      },
    ]);

    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    const mapMonthly = (data) =>
      months.map((m) => data.find((d) => d._id === m)?.total || 0);

    res.json({
      totalSales: salesAgg?.total || 0,
      totalPurchase: purchaseAgg?.total || 0,
      totalPayments: paymentAgg?.total || 0,
      totalProducts,
      monthlySales: mapMonthly(salesMonthly),
      monthlyPurchase: mapMonthly(purchaseMonthly),
    });
  } catch (err) {
    console.error("Dashboard Error:", err);
    res.status(500).json({ error: "Failed to load dashboard" });
  }
};
