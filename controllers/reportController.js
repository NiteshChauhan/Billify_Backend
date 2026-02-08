import StockLedger from "@/models/StockLedger";
import Product from "@/models/Product";
import Supplier from "@/models/Supplier";
import Vendor from "@/models/Vendor";
import PurchaseInvoice from "@/models/PurchaseInvoice";
import SalesInvoice from "@/models/SalesInvoice";
import Payment from "@/models/Payment";

/* ================= STOCK REPORT ================= */
export const stockReport = async (req, res) => {
  const companyId = req.user.companyId;

  const report = await StockLedger.aggregate([
    { $match: { companyId } },
    {
      $group: {
        _id: "$productId",
        inQty: {
          $sum: { $cond: [{ $eq: ["$type", "IN"] }, "$quantity", 0] },
        },
        outQty: {
          $sum: { $cond: [{ $eq: ["$type", "OUT"] }, "$quantity", 0] },
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
};

/* ================= SUPPLIER DUE ================= */
export const supplierDueReport = async (req, res) => {
  const suppliers = await Supplier.find({
    companyId: req.user.companyId,
  }).select("name balance");

  res.json(suppliers);
};

/* ================= VENDOR DUE ================= */
export const vendorDueReport = async (req, res) => {
  const vendors = await Vendor.find({
    companyId: req.user.companyId,
  }).select("name balance");

  res.json(vendors);
};

/* ================= PURCHASE REPORT ================= */
export const purchaseReport = async (req, res) => {
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
};

/* ================= SALES REPORT ================= */
export const salesReport = async (req, res) => {
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
};

/* ================= PROFIT / LOSS ================= */
export const profitLossReport = async (req, res) => {
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
};

/* ================= PARTY LEDGER ================= */
export const partyLedger = async (req, res) => {
  const { partyType, partyId } = req.query;

  const invoices =
    partyType === "SUPPLIER"
      ? await PurchaseInvoice.find({ supplierId: partyId })
      : await SalesInvoice.find({ vendorId: partyId });

  const payments = await Payment.find({ partyType, partyId });

  res.json({ invoices, payments });
};
