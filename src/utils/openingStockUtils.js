const Product = require("../models/Product");
const StockLedger = require("../models/StockLedger");
const StockBatch = require("../models/StockBatch");

const OPENING_REFERENCE_TYPE = "OPENING_STOCK";
const OPENING_BLOCKING_TYPES = [
  "PURCHASE",
  "SALE",
  "PURCHASE_RETURN",
  "SALE_RETURN",
  "ADJUSTMENT",
];

const toNumber = (value, fallback = 0) => {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
};

const buildError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const getPositiveBatches = async (companyId, productId) =>
  StockBatch.find({
    companyId,
    productId,
    remainingQty: { $gt: 0 },
  }).sort({ createdAt: 1, _id: 1 });

const getOpeningBatch = async (companyId, productId, openingEntryId) => {
  if (!openingEntryId) return null;
  return StockBatch.findOne({
    companyId,
    productId,
    sourceType: "OPENING",
    sourceId: openingEntryId,
  }).sort({ createdAt: 1, _id: 1 });
};

const reduceOtherBatches = async ({
  companyId,
  productId,
  quantity,
  excludeBatchId = null,
}) => {
  let remaining = Math.max(0, toNumber(quantity, 0));
  if (!(remaining > 0)) return;

  const batches = await getPositiveBatches(companyId, productId);
  const updates = [];

  for (const batch of batches) {
    if (remaining <= 0) break;
    if (excludeBatchId && String(batch._id) === String(excludeBatchId)) {
      continue;
    }

    const available = toNumber(batch.remainingQty, 0);
    if (!(available > 0)) continue;

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
    throw buildError("Stock cannot be reduced below zero", 400);
  }

  if (updates.length) {
    await StockBatch.bulkWrite(updates);
  }
};

const getOpeningStockSnapshot = async (companyId, productId) => {
  const [product, openingEntry, hasTransactions] = await Promise.all([
    Product.findOne({ _id: productId, companyId }),
    StockLedger.findOne({
      companyId,
      productId,
      type: "OPENING",
    }).sort({ createdAt: 1, _id: 1 }),
    StockLedger.exists({
      companyId,
      productId,
      type: { $in: OPENING_BLOCKING_TYPES },
    }),
  ]);

  return {
    product,
    openingEntry,
    hasTransactions: Boolean(hasTransactions),
    quantity: toNumber(openingEntry?.quantity, 0),
    rate: toNumber(openingEntry?.rate, 0),
  };
};

const assertProductExists = async (companyId, productId) => {
  const product = await Product.findOne({ _id: productId, companyId });
  if (!product) {
    throw buildError("Product not found", 404);
  }
  return product;
};

const assertOpeningStockEditable = async (companyId, productId, nextQuantity, nextRate) => {
  const snapshot = await getOpeningStockSnapshot(companyId, productId);
  const normalizedQuantity = Math.max(0, toNumber(nextQuantity, 0));

  if (!snapshot.product) {
    throw buildError("Product not found", 404);
  }

  const positiveBatches = await getPositiveBatches(companyId, productId);
  const totalAvailable = positiveBatches.reduce(
    (sum, batch) => sum + toNumber(batch.remainingQty, 0),
    0,
  );
  const nextAvailable = totalAvailable + (normalizedQuantity - snapshot.quantity);

  if (nextAvailable < 0) {
    throw buildError("Stock cannot be reduced below zero", 400);
  }

  return snapshot;
};

const syncOpeningStock = async ({
  companyId,
  productId,
  quantity,
  rate,
  syncProductFields = true,
}) => {
  const normalizedQuantity = Math.max(0, toNumber(quantity, 0));
  const normalizedRate = Math.max(0, toNumber(rate, 0));

  const product = syncProductFields
    ? await assertProductExists(companyId, productId)
    : null;

  const openingEntry = await StockLedger.findOne({
    companyId,
    productId,
    type: "OPENING",
  }).sort({ createdAt: 1, _id: 1 });
  const openingBatch = await getOpeningBatch(companyId, productId, openingEntry?._id);
  const oldQuantity = toNumber(openingEntry?.quantity, 0);
  const delta = normalizedQuantity - oldQuantity;
  const totalAvailableBefore = (
    await getPositiveBatches(companyId, productId)
  ).reduce((sum, batch) => sum + toNumber(batch.remainingQty, 0), 0);
  const targetAvailable = totalAvailableBefore + delta;

  let activeEntry = openingEntry;

  if (targetAvailable < 0) {
    throw buildError("Stock cannot be reduced below zero", 400);
  }

  if (normalizedQuantity > 0) {
    if (!openingEntry) {
      activeEntry = await StockLedger.create({
        companyId,
        productId,
        type: "OPENING",
        quantity: normalizedQuantity,
        rate: normalizedRate,
        referenceType: OPENING_REFERENCE_TYPE,
        referenceId: productId,
      });
    } else {
      openingEntry.quantity = normalizedQuantity;
      openingEntry.rate = normalizedRate;
      openingEntry.referenceType = OPENING_REFERENCE_TYPE;
      openingEntry.referenceId = productId;
      await openingEntry.save();
    }

    const nonOpeningAvailable = totalAvailableBefore - toNumber(openingBatch?.remainingQty, 0);
    const desiredOpeningRemaining = targetAvailable - nonOpeningAvailable;

    if (openingBatch) {
      openingBatch.totalQty = normalizedQuantity;
      openingBatch.remainingQty = Math.max(0, desiredOpeningRemaining);
      openingBatch.rate = normalizedRate;
      await openingBatch.save();
    } else {
      await StockBatch.create({
        companyId,
        productId,
        sourceType: "OPENING",
        sourceId: activeEntry._id,
        totalQty: normalizedQuantity,
        remainingQty: Math.max(0, desiredOpeningRemaining),
        rate: normalizedRate,
      });
    }

    if (desiredOpeningRemaining < 0) {
      const latestOpeningBatch = await getOpeningBatch(companyId, productId, activeEntry._id);
      await reduceOtherBatches({
        companyId,
        productId,
        quantity: Math.abs(desiredOpeningRemaining),
        excludeBatchId: latestOpeningBatch?._id || null,
      });
    }

    await StockBatch.deleteMany({
      companyId,
      productId,
      sourceType: "OPENING",
      sourceId: { $ne: activeEntry._id },
    });
  } else if (openingEntry) {
    await reduceOtherBatches({
      companyId,
      productId,
      quantity: Math.max(0, oldQuantity - toNumber(openingBatch?.remainingQty, 0)),
      excludeBatchId: openingBatch?._id || null,
    });
    await StockBatch.deleteMany({
      companyId,
      productId,
      sourceType: "OPENING",
    });
    await StockLedger.deleteMany({
      companyId,
      productId,
      type: "OPENING",
    });
    activeEntry = null;
  }

  if (syncProductFields && product) {
    product.openingStock = normalizedQuantity;
    product.openingRate = normalizedRate;
    await product.save();
  }

  return {
    quantity: normalizedQuantity,
    rate: normalizedRate,
    amount: Number((normalizedQuantity * normalizedRate).toFixed(4)),
    openingEntry: activeEntry,
  };
};

module.exports = {
  OPENING_BLOCKING_TYPES,
  getOpeningStockSnapshot,
  assertOpeningStockEditable,
  syncOpeningStock,
};
