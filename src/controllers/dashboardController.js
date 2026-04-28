const mongoose = require("mongoose");
const SalesInvoice = require("../models/SalesInvoice");
const PurchaseInvoice = require("../models/PurchaseInvoice");
const Payment = require("../models/Payment");
const Product = require("../models/Product");
const { getDateRangeFromQuery } = require("../utils/dateRange");
const { withBranchScope } = require("../utils/branchScope");

exports.getDashboardSummary = async (req, res) => {
  try {
    const companyObjectId = new mongoose.Types.ObjectId(String(req.user.companyId));
    const range = getDateRangeFromQuery(req.query);
    const invoiceDateFilter = range
      ? { invoiceDate: { $gte: range.fromDate, $lte: range.toDate } }
      : {};

    const salesMatch = withBranchScope({ companyId: companyObjectId, ...invoiceDateFilter }, req.user.branchId, req.user.branchIsDefault);
    const purchaseMatch = withBranchScope({ companyId: companyObjectId, ...invoiceDateFilter }, req.user.branchId, req.user.branchIsDefault);
    const paymentMatch = withBranchScope(
      {
        companyId: companyObjectId,
        invoiceType: "SALE",
        ...(range ? { paymentDate: { $gte: range.fromDate, $lte: range.toDate } } : {}),
      },
      req.user.branchId,
      req.user.branchIsDefault,
    );

    const [salesAgg, purchaseAgg, paymentAgg, totalProducts] = await Promise.all([
      SalesInvoice.aggregate([
        { $match: salesMatch },
        { $group: { _id: null, total: { $sum: "$totalAmount" } } },
      ]),
      PurchaseInvoice.aggregate([
        { $match: purchaseMatch },
        { $group: { _id: null, total: { $sum: "$totalAmount" } } },
      ]),
      Payment.aggregate([
        { $match: paymentMatch },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      Product.countDocuments({ companyId: companyObjectId }),
    ]);

    const year = new Date().getFullYear();
    const start = new Date(`${year}-01-01T00:00:00.000Z`);
    const end = new Date(`${year}-12-31T23:59:59.999Z`);

    const buildMonthlyPipeline = () => [
      { $match: withBranchScope({ companyId: companyObjectId }, req.user.branchId, req.user.branchIsDefault) },
      {
        $addFields: {
          chartDate: {
            $convert: {
              input: "$invoiceDate",
              to: "date",
              onError: "$createdAt",
              onNull: "$createdAt",
            },
          },
        },
      },
      { $match: { chartDate: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: { $month: "$chartDate" },
          total: { $sum: "$totalAmount" },
        },
      },
    ];

    const [salesMonthly, purchaseMonthly] = await Promise.all([
      SalesInvoice.aggregate(buildMonthlyPipeline()),
      PurchaseInvoice.aggregate(buildMonthlyPipeline()),
    ]);

    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    const mapMonthly = (data) =>
      months.map((m) => Number(data.find((d) => d._id === m)?.total || 0));

    res.json({
      totalSales: Number(salesAgg?.[0]?.total || 0),
      totalPurchase: Number(purchaseAgg?.[0]?.total || 0),
      totalPayments: Number(paymentAgg?.[0]?.total || 0),
      totalProducts: Number(totalProducts || 0),
      monthlySales: mapMonthly(salesMonthly),
      monthlyPurchase: mapMonthly(purchaseMonthly),
    });
  } catch (err) {
    console.error("Dashboard Error:", err);
    res.status(500).json({
      error: "Failed to load dashboard",
      message: err.message,
    });
  }
};
