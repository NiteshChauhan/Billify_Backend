import SalesInvoice from "../models/SalesInvoice";
import PurchaseInvoice from "../models/PurchaseInvoice";
import Payment from "../models/Payment";
import Product from "../models/Product";

export const getDashboardSummary = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    if (!companyId) {
      return res.status(400).json({ message: "Company not found in token" });
    }

    /* ================= KPI TOTALS ================= */

    const [salesAgg] = await SalesInvoice.aggregate([
      { $match: { companyId } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]);

    const [purchaseAgg] = await PurchaseInvoice.aggregate([
      { $match: { companyId } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]);

    const [paymentAgg] = await Payment.aggregate([
      { $match: { companyId, invoiceType: "SALE" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const totalProducts = await Product.countDocuments({ companyId });

    /* ================= MONTHLY CHART ================= */

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

    /* ================= NORMALIZE MONTHS ================= */

    const months = Array.from({ length: 12 }, (_, i) => i + 1);

    const mapMonthly = (data) =>
      months.map((m) => data.find((d) => d._id === m)?.total || 0);

    return res.status(200).json({
      success: true,
      totalSales: salesAgg?.total || 0,
      totalPurchase: purchaseAgg?.total || 0,
      totalPayments: paymentAgg?.total || 0,
      totalProducts,
      monthlySales: mapMonthly(salesMonthly),
      monthlyPurchase: mapMonthly(purchaseMonthly),
    });
  } catch (err) {
    console.error("Dashboard Error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to load dashboard",
    });
  }
};
