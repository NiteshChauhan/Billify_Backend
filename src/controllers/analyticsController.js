const mongoose = require("mongoose");
const SalesInvoice = require("../models/SalesInvoice");
const Party = require("../models/Party");
const Site = require("../models/Site");
const Applicator = require("../models/Applicator");
const { withBranchScope } = require("../utils/branchScope");

const toObjectId = (value) => {
  if (!value || !mongoose.Types.ObjectId.isValid(String(value))) return null;
  return new mongoose.Types.ObjectId(String(value));
};

const moneyExpr = {
  $ifNull: [
    "$items.amount",
    {
      $multiply: [
        { $ifNull: ["$items.quantity", 0] },
        { $ifNull: ["$items.rate", 0] },
      ],
    },
  ],
};

const buildMatch = (req) => {
  const companyId = toObjectId(req.user.companyId) || req.user.companyId;
  const match = withBranchScope(
    { companyId, isDeleted: false },
    req.user.branchId,
    req.user.branchIsDefault,
  );

  const fromDate = req.query.fromDate || req.query.from;
  const toDate = req.query.toDate || req.query.to;
  if (fromDate || toDate) {
    match.invoiceDate = {};
    if (fromDate) match.invoiceDate.$gte = new Date(fromDate);
    if (toDate) {
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);
      match.invoiceDate.$lte = to;
    }
  }

  ["partyId", "siteId", "applicatorId"].forEach((key) => {
    const objectId = toObjectId(req.query[key]);
    if (objectId) match[key] = objectId;
  });

  const status = String(req.query.paymentStatus || req.query.invoiceStatus || req.query.status || "").trim();
  if (status) match.status = status.toUpperCase();

  const productId = toObjectId(req.query.productId || req.query.itemId);
  if (productId) match["items.productId"] = productId;

  return match;
};

exports.getInvoiceAnalytics = async (req, res) => {
  try {
    const match = buildMatch(req);
    const ownerId = req.user.companyId;

    const [
      overviewRows,
      qtyRows,
      applicatorSummary,
      itemSummary,
      partySummary,
      distribution,
      activeParties,
      activeSites,
      activeApplicators,
    ] = await Promise.all([
      SalesInvoice.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            invoiceCount: { $sum: 1 },
            totalAmount: { $sum: { $ifNull: ["$totalAmount", 0] } },
            paidAmount: { $sum: { $ifNull: ["$paidAmount", 0] } },
            pendingAmount: { $sum: { $ifNull: ["$pendingAmount", 0] } },
          },
        },
      ]),
      SalesInvoice.aggregate([
        { $match: match },
        { $unwind: "$items" },
        { $group: { _id: null, totalQuantity: { $sum: { $ifNull: ["$items.quantity", 0] } } } },
      ]),
      SalesInvoice.aggregate([
        { $match: match },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$applicatorId",
            applicatorName: { $first: "$applicatorName" },
            invoiceIds: { $addToSet: "$_id" },
            totalQuantity: { $sum: { $ifNull: ["$items.quantity", 0] } },
            totalValue: { $sum: moneyExpr },
          },
        },
        { $project: { _id: 0, applicatorId: "$_id", applicatorName: { $ifNull: ["$applicatorName", "Unassigned"] }, invoiceCount: { $size: "$invoiceIds" }, totalQuantity: 1, totalValue: 1 } },
        { $sort: { totalValue: -1, totalQuantity: -1 } },
        { $limit: 50 },
      ]),
      SalesInvoice.aggregate([
        { $match: match },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.productId",
            productName: { $first: "$items.productName" },
            unitName: { $first: "$items.unitName" },
            invoiceIds: { $addToSet: "$_id" },
            totalQuantity: { $sum: { $ifNull: ["$items.quantity", 0] } },
            totalValue: { $sum: moneyExpr },
          },
        },
        { $project: { _id: 0, productId: "$_id", productName: { $ifNull: ["$productName", "Item"] }, unitName: 1, invoiceCount: { $size: "$invoiceIds" }, totalQuantity: 1, totalValue: 1 } },
        { $sort: { totalValue: -1, totalQuantity: -1 } },
        { $limit: 50 },
      ]),
      SalesInvoice.aggregate([
        { $match: match },
        {
          $group: {
            _id: "$partyId",
            invoiceCount: { $sum: 1 },
            totalValue: { $sum: { $ifNull: ["$totalAmount", 0] } },
            paidAmount: { $sum: { $ifNull: ["$paidAmount", 0] } },
            outstandingAmount: { $sum: { $ifNull: ["$pendingAmount", 0] } },
          },
        },
        { $lookup: { from: "parties", localField: "_id", foreignField: "_id", as: "party" } },
        { $project: { _id: 0, partyId: "$_id", partyName: { $ifNull: [{ $first: "$party.name" }, "Unassigned"] }, invoiceCount: 1, totalValue: 1, paidAmount: 1, outstandingAmount: 1 } },
        { $sort: { totalValue: -1, invoiceCount: -1 } },
        { $limit: 50 },
      ]),
      SalesInvoice.aggregate([
        { $match: match },
        { $unwind: "$items" },
        {
          $group: {
            _id: {
              partyId: "$partyId",
              siteId: "$siteId",
              applicatorId: "$applicatorId",
              productId: "$items.productId",
            },
            productName: { $first: "$items.productName" },
            unitName: { $first: "$items.unitName" },
            applicatorName: { $first: "$applicatorName" },
            customerBranch: { $first: "$customerBranch" },
            invoiceIds: { $addToSet: "$_id" },
            totalQuantity: { $sum: { $ifNull: ["$items.quantity", 0] } },
            totalValue: { $sum: moneyExpr },
          },
        },
        { $lookup: { from: "parties", localField: "_id.partyId", foreignField: "_id", as: "party" } },
        { $lookup: { from: "sites", localField: "_id.siteId", foreignField: "_id", as: "site" } },
        { $project: { _id: 0, partyId: "$_id.partyId", siteId: "$_id.siteId", applicatorId: "$_id.applicatorId", productId: "$_id.productId", partyName: { $ifNull: [{ $first: "$party.name" }, "Unassigned"] }, siteName: { $ifNull: [{ $first: "$site.name" }, "$customerBranch"] }, applicatorName: { $ifNull: ["$applicatorName", "Unassigned"] }, productName: { $ifNull: ["$productName", "Item"] }, unitName: 1, invoiceCount: { $size: "$invoiceIds" }, totalQuantity: 1, totalValue: 1 } },
        { $sort: { totalValue: -1, totalQuantity: -1 } },
        { $limit: 100 },
      ]),
      Party.countDocuments(withBranchScope({ companyId: ownerId, isActive: true }, req.user.branchId, req.user.branchIsDefault)),
      Site.countDocuments({ adminId: ownerId, isDeleted: false, status: "active" }),
      Applicator.countDocuments({ adminId: ownerId, isDeleted: false, status: "active" }),
    ]);

    const overview = overviewRows[0] || { invoiceCount: 0, totalAmount: 0, paidAmount: 0, pendingAmount: 0 };
    overview.totalQuantity = Number(qtyRows[0]?.totalQuantity || 0);
    overview.activeParties = activeParties;
    overview.activeSites = activeSites;
    overview.activeApplicators = activeApplicators;

    res.json({ success: true, overview, applicatorSummary, itemSummary, partySummary, distribution });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to load analytics", error: err.message });
  }
};
