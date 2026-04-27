const Branch = require("../models/Branch");
const Company = require("../models/Company");
const Product = require("../models/Product");
const StockBatch = require("../models/StockBatch");
const StockLedger = require("../models/StockLedger");
const StockTransfer = require("../models/StockTransfer");
const { consumeBatches, ensureLegacyBatch, getAvailableStock } = require("../utils/stockUtils");

const normalizeDate = (value) => {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? null : date;
};

const loadBranchPair = async (companyId, fromBranchId, toBranchId) => {
  const branches = await Branch.find({
    companyId,
    _id: { $in: [fromBranchId, toBranchId] },
    status: "active",
  }).lean();
  const fromBranch = branches.find((branch) => String(branch._id) === String(fromBranchId));
  const toBranch = branches.find((branch) => String(branch._id) === String(toBranchId));
  return { fromBranch, toBranch };
};

exports.listTransfers = async (req, res) => {
  try {
    const transfers = await StockTransfer.find({
      companyId: req.user.companyId,
      $or: [
        { fromBranchId: req.user.branchId || null },
        { toBranchId: req.user.branchId || null },
      ],
    })
      .populate("fromBranchId", "branchName branchCode")
      .populate("toBranchId", "branchName branchCode")
      .populate("items.productId", "name sku")
      .sort({ transferDate: -1, createdAt: -1 });

    res.json(transfers);
  } catch (err) {
    res.status(500).json({ message: "Failed to load stock transfers", error: err.message });
  }
};

exports.createTransfer = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const currentBranchId = req.user.branchId || null;
    const {
      transferDate,
      fromBranchId = currentBranchId,
      toBranchId,
      items = [],
      remarks = "",
    } = req.body;

    if (!fromBranchId || !toBranchId) {
      return res.status(400).json({ message: "fromBranchId and toBranchId are required" });
    }
    if (String(fromBranchId) === String(toBranchId)) {
      return res.status(400).json({ message: "Source and destination branch cannot be same" });
    }
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ message: "At least one transfer item is required" });
    }

    const { fromBranch, toBranch } = await loadBranchPair(companyId, fromBranchId, toBranchId);
    if (!fromBranch || !toBranch) {
      return res.status(400).json({ message: "Invalid branch selection" });
    }

    const company = await Company.findById(companyId).select("stockSettlementEnabled");
    const stockSettlementEnabled = Boolean(company?.stockSettlementEnabled);

    const productIds = [...new Set(items.map((item) => String(item.productId || "")).filter(Boolean))];
    const products = await Product.find({
      companyId,
      _id: { $in: productIds },
    }).select("_id name sku");
    const productMap = new Map(products.map((product) => [String(product._id), product]));

    const normalizedItems = [];
    for (const item of items) {
      const productId = String(item.productId || "");
      const qty = Number(item.qty || item.quantity || 0);
      if (!productId || !(qty > 0)) {
        return res.status(400).json({ message: "Each transfer item must have productId and qty > 0" });
      }
      const product = productMap.get(productId);
      if (!product) {
        return res.status(400).json({ message: "Invalid product in transfer items" });
      }
      await ensureLegacyBatch(companyId, fromBranchId, productId, transferDate || new Date());
      if (stockSettlementEnabled) {
        const available = await getAvailableStock(companyId, fromBranchId, productId, transferDate || new Date());
        if (available < qty) {
          return res.status(400).json({
            message: "Insufficient stock for branch transfer",
            productId,
            productName: product.name,
            availableStock: available,
          });
        }
      }
      normalizedItems.push({
        productId,
        qty,
      });
    }

    const count = await StockTransfer.countDocuments({ companyId });
    const transferNo = `TRF-${count + 1}`;
    const effectiveDate = normalizeDate(transferDate);
    if (!effectiveDate) {
      return res.status(400).json({ message: "Invalid transferDate" });
    }

    const persistedItems = [];
    for (const item of normalizedItems) {
      const consumption = await consumeBatches({
        companyId,
        branchId: fromBranchId,
        productId: item.productId,
        quantity: item.qty,
        asOfDate: effectiveDate,
        sourceHint: "TRANSFER_OUT",
        allowNegative: !stockSettlementEnabled,
      });
      const totalCost = Number(consumption.actualCost || 0);
      const rate = item.qty > 0 ? Number((totalCost / item.qty).toFixed(4)) : 0;
      persistedItems.push({
        productId: item.productId,
        qty: item.qty,
        rate,
        amount: Number((rate * item.qty).toFixed(4)),
      });
    }

    const transfer = await StockTransfer.create({
      companyId,
      transferNo,
      fromBranchId,
      toBranchId,
      transferDate: effectiveDate,
      status: "completed",
      remarks: String(remarks || "").trim(),
      items: persistedItems,
      createdBy: req.user.userId,
      completedBy: req.user.userId,
      completedAt: new Date(),
    });

    for (const item of persistedItems) {
      await StockLedger.create({
        companyId,
        branchId: fromBranchId,
        productId: item.productId,
        type: "TRANSFER_OUT",
        quantity: item.qty,
        rate: item.rate,
        referenceType: "STOCK_TRANSFER",
        referenceId: transfer._id,
        createdAt: effectiveDate,
      });
      await StockLedger.create({
        companyId,
        branchId: toBranchId,
        productId: item.productId,
        type: "TRANSFER_IN",
        quantity: item.qty,
        rate: item.rate,
        referenceType: "STOCK_TRANSFER",
        referenceId: transfer._id,
        createdAt: effectiveDate,
      });
      await StockBatch.create({
        companyId,
        branchId: toBranchId,
        productId: item.productId,
        sourceType: "TRANSFER_IN",
        sourceId: transfer._id,
        totalQty: item.qty,
        remainingQty: item.qty,
        rate: item.rate,
        createdAt: effectiveDate,
        updatedAt: effectiveDate,
      });
    }

    const populated = await StockTransfer.findById(transfer._id)
      .populate("fromBranchId", "branchName branchCode")
      .populate("toBranchId", "branchName branchCode")
      .populate("items.productId", "name sku");
    res.json(populated);
  } catch (err) {
    if (err.code === "INSUFFICIENT_STOCK") {
      return res.status(400).json({
        message: "Insufficient stock for branch transfer",
        productId: err.productId,
        availableStock: err.availableStock,
      });
    }
    res.status(500).json({ message: "Failed to create stock transfer", error: err.message });
  }
};
