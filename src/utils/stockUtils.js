const StockLedger = require("../models/StockLedger");
const StockBatch = require("../models/StockBatch");

const getLedgerAvailableStock = async (companyId, productId) => {
  const entries = await StockLedger.find({ companyId, productId });
  let stock = 0;
  entries.forEach((entry) => {
    if (["PURCHASE", "OPENING", "SALE_RETURN"].includes(entry.type)) {
      stock += Number(entry.quantity || 0);
    } else {
      stock -= Number(entry.quantity || 0);
    }
  });
  return stock;
};

const computeLedgerAverageCost = async (companyId, productId, untilDate = new Date()) => {
  const entries = await StockLedger.find({
    companyId,
    productId,
    type: { $in: ["PURCHASE", "OPENING", "PURCHASE_RETURN"] },
    createdAt: { $lte: untilDate },
  });

  const totalQty = entries.reduce(
    (sum, entry) =>
      sum + Number(entry.quantity || 0) * (entry.type === "PURCHASE_RETURN" ? -1 : 1),
    0,
  );

  const totalValue = entries.reduce(
    (sum, entry) =>
      sum +
      Number(entry.quantity || 0) *
        Number(entry.rate || 0) *
        (entry.type === "PURCHASE_RETURN" ? -1 : 1),
    0,
  );

  return totalQty > 0 ? totalValue / totalQty : 0;
};

const ensureLegacyBatch = async (companyId, productId, asOfDate = new Date()) => {
  const existing = await StockBatch.exists({ companyId, productId });
  if (existing) return;

  const available = await getLedgerAvailableStock(companyId, productId);
  if (!(available > 0)) return;

  const avgRate = await computeLedgerAverageCost(companyId, productId, asOfDate);
  await StockBatch.create({
    companyId,
    productId,
    sourceType: "LEGACY",
    sourceId: null,
    totalQty: available,
    remainingQty: available,
    rate: avgRate,
  });
};

const getBatchAvailableStock = async (companyId, productId) => {
  const result = await StockBatch.aggregate([
    { $match: { companyId, productId } },
    { $group: { _id: null, total: { $sum: "$remainingQty" }, count: { $sum: 1 } } },
  ]);
  if (!result.length) return { total: 0, count: 0 };
  return { total: Number(result[0].total || 0), count: Number(result[0].count || 0) };
};

const getAvailableStock = async (companyId, productId, asOfDate = new Date()) => {
  const batch = await getBatchAvailableStock(companyId, productId);
  const ledgerTotal = await getLedgerAvailableStock(companyId, productId);

  if (batch.count > 0) {
    const diff = Number(ledgerTotal || 0) - Number(batch.total || 0);
    if (diff > 0) {
      const avgRate = await computeLedgerAverageCost(companyId, productId, asOfDate);
      await StockBatch.create({
        companyId,
        productId,
        sourceType: "LEGACY",
        sourceId: null,
        totalQty: diff,
        remainingQty: diff,
        rate: avgRate,
      });
      return ledgerTotal;
    }
    if (diff < 0) {
      return ledgerTotal;
    }
    return batch.total;
  }

  return ledgerTotal;
};

const consumeBatches = async ({
  companyId,
  productId,
  quantity,
  asOfDate = new Date(),
  sourceHint = "",
  allowNegative = false,
}) => {
  await ensureLegacyBatch(companyId, productId, asOfDate);
  const batches = await StockBatch.find({
    companyId,
    productId,
    remainingQty: { $gt: 0 },
  }).sort({ createdAt: 1, _id: 1 });

  let remaining = Number(quantity || 0);
  if (!(remaining > 0)) {
    return { breakdown: [], actualCost: 0 };
  }

  const updates = [];
  const breakdown = [];
  let cost = 0;
  const totalAvailable = batches.reduce((sum, batch) => sum + Number(batch.remainingQty || 0), 0);

  for (const batch of batches) {
    if (remaining <= 0) break;
    const available = Number(batch.remainingQty || 0);
    if (available <= 0) continue;
    const used = Math.min(available, remaining);
    const rate = Number(batch.rate || 0);
    cost += used * rate;
    breakdown.push({
      batchId: batch._id,
      qty: used,
      rate,
      cost: Number((used * rate).toFixed(4)),
      sourceHint,
    });
    updates.push({
      updateOne: {
        filter: { _id: batch._id, companyId },
        update: { $inc: { remainingQty: -used } },
      },
    });
    remaining -= used;
  }

  if (remaining > 0) {
    if (allowNegative) {
      if (updates.length) {
        await StockBatch.bulkWrite(updates);
      }
      return {
        breakdown,
        actualCost: Number(cost.toFixed(4)),
        shortageQty: remaining,
      };
    }
    const error = new Error("Insufficient stock");
    error.code = "INSUFFICIENT_STOCK";
    error.productId = productId;
    error.availableStock = totalAvailable;
    throw error;
  }

  if (updates.length) {
    await StockBatch.bulkWrite(updates);
  }

  return {
    breakdown,
    actualCost: Number(cost.toFixed(4)),
    shortageQty: 0,
  };
};

const previewConsumeBatches = async ({ companyId, productId, quantity, asOfDate = new Date() }) => {
  await ensureLegacyBatch(companyId, productId, asOfDate);
  const batches = await StockBatch.find({
    companyId,
    productId,
    remainingQty: { $gt: 0 },
  }).sort({ createdAt: 1, _id: 1 });

  let remaining = Number(quantity || 0);
  const breakdown = [];
  let cost = 0;
  let available = 0;

  for (const batch of batches) {
    const availableQty = Number(batch.remainingQty || 0);
    available += availableQty;
    if (remaining <= 0 || availableQty <= 0) continue;
    const used = Math.min(availableQty, remaining);
    const rate = Number(batch.rate || 0);
    cost += used * rate;
    breakdown.push({
      batchId: batch._id,
      qty: used,
      rate,
      cost: Number((used * rate).toFixed(4)),
    });
    remaining -= used;
  }

  return {
    available,
    requested: Number(quantity || 0),
    remainingNeeded: remaining,
    actualCost: Number(cost.toFixed(4)),
    breakdown,
  };
};

const restoreBatchesFromBreakdown = async (companyId, breakdown = [], quantity) => {
  let remaining = Number(quantity || 0);
  if (!(remaining > 0)) return;

  const updates = [];
  for (const entry of breakdown) {
    if (remaining <= 0) break;
    const available = Number(entry.qty || 0);
    if (available <= 0) continue;
    const restoreQty = Math.min(available, remaining);
    updates.push({
      updateOne: {
        filter: { _id: entry.batchId, companyId },
        update: { $inc: { remainingQty: restoreQty } },
      },
    });
    remaining -= restoreQty;
  }

  if (updates.length) {
    await StockBatch.bulkWrite(updates);
  }
};

const restoreByAverageCost = async (companyId, productId, quantity, asOfDate = new Date()) => {
  const qty = Number(quantity || 0);
  if (!(qty > 0)) return;
  const avgRate = await computeLedgerAverageCost(companyId, productId, asOfDate);
  await StockBatch.create({
    companyId,
    productId,
    sourceType: "SALE_RETURN",
    sourceId: null,
    totalQty: qty,
    remainingQty: qty,
    rate: avgRate,
  });
};

const consumePurchaseBatches = async (companyId, productId, purchaseId, quantity) => {
  const batches = await StockBatch.find({
    companyId,
    productId,
    sourceType: "PURCHASE",
    sourceId: purchaseId,
    remainingQty: { $gt: 0 },
  }).sort({ createdAt: 1, _id: 1 });

  let remaining = Number(quantity || 0);
  if (!(remaining > 0)) return;

  const updates = [];
  for (const batch of batches) {
    if (remaining <= 0) break;
    const available = Number(batch.remainingQty || 0);
    if (available <= 0) continue;
    const used = Math.min(available, remaining);
    updates.push({
      updateOne: {
        filter: { _id: batch._id, companyId },
        update: { $inc: { remainingQty: -used } },
      },
    });
    remaining -= used;
  }

  if (remaining > 0) {
    throw new Error(`Insufficient stock for purchase return. Available from purchase: ${Number(quantity || 0) - remaining}`);
  }

  if (updates.length) {
    await StockBatch.bulkWrite(updates);
  }
};

module.exports = {
  getAvailableStock,
  getLedgerAvailableStock,
  computeLedgerAverageCost,
  ensureLegacyBatch,
  consumeBatches,
  previewConsumeBatches,
  restoreBatchesFromBreakdown,
  restoreByAverageCost,
  consumePurchaseBatches,
};
