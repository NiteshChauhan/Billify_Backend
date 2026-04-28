const ReturnEntry = require("../models/Return");
const SalesInvoice = require("../models/SalesInvoice");
const PurchaseInvoice = require("../models/PurchaseInvoice");
const StockLedger = require("../models/StockLedger");
const Party = require("../models/Party");
const Product = require("../models/Product");
const Payment = require("../models/Payment");
const StockBatch = require("../models/StockBatch");
const BankAccount = require("../models/BankAccount");
const {
  getAvailableStock,
  restoreBatchesFromBreakdown,
  restoreByAverageCost,
  consumePurchaseBatches,
  consumeBatches,
  computeLedgerAverageCost,
} = require("../utils/stockUtils");
const { getDateRangeFromQuery } = require("../utils/dateRange");
const { withBranchScope } = require("../utils/branchScope");

const normalizeReturnType = (value = "") => {
  const type = String(value).toUpperCase();
  return type === "PURCHASE_RETURN" ? "PURCHASE_RETURN" : "SALE_RETURN";
};

const getBillModelByReturnType = (returnType) =>
  returnType === "PURCHASE_RETURN" ? PurchaseInvoice : SalesInvoice;

const consumeSpecificBatchBreakdown = async (companyId, breakdown = [], quantity) => {
  let remaining = Number(quantity || 0);
  if (!(remaining > 0)) return;

  for (const entry of breakdown) {
    if (remaining <= 0) break;
    const maxQty = Number(entry.qty || 0);
    if (!(maxQty > 0) || !entry.batchId) continue;

    const batch = await StockBatch.findOne({
      _id: entry.batchId,
      companyId,
    });

    if (!batch || Number(batch.remainingQty || 0) <= 0) {
      throw new Error("Returned stock has already been used and cannot be deleted");
    }

    const consumeQty = Math.min(maxQty, remaining, Number(batch.remainingQty || 0));
    if (!(consumeQty > 0)) continue;

    batch.remainingQty = Number(batch.remainingQty || 0) - consumeQty;
    await batch.save();
    remaining -= consumeQty;
  }

  if (remaining > 0) {
    throw new Error("Returned stock has already been used and cannot be deleted");
  }
};

const restorePurchaseBatches = async (companyId, purchaseId, productId, quantity) => {
  let remaining = Number(quantity || 0);
  if (!(remaining > 0)) return;

  const batches = await StockBatch.find({
    companyId,
    productId,
    sourceType: "PURCHASE",
    sourceId: purchaseId,
  }).sort({ createdAt: 1, _id: 1 });

  for (const batch of batches) {
    if (remaining <= 0) break;
    const capacity = Math.max(0, Number(batch.totalQty || 0) - Number(batch.remainingQty || 0));
    if (!(capacity > 0)) continue;
    const restoreQty = Math.min(capacity, remaining);
    batch.remainingQty = Number(batch.remainingQty || 0) + restoreQty;
    await batch.save();
    remaining -= restoreQty;
  }

  if (remaining > 0) {
    throw new Error("Purchase return cannot be deleted because the original purchase stock mapping is no longer available");
  }
};

const validateItems = (items = []) => {
  if (!Array.isArray(items) || !items.length) {
    throw new Error("Return items are required");
  }
  items.forEach((item) => {
    if (!item.productId || !item.quantity || Number(item.quantity) <= 0) {
      throw new Error("Invalid return item data");
    }
    item.rate = Number(item.rate || 0);
    item.quantity = Number(item.quantity);
    item.amount = Number((item.quantity * item.rate).toFixed(2));
  });
};

const computeReturnCostFromBreakdown = (breakdown = [], returnQty = 0) => {
  let remaining = Number(returnQty || 0);
  let cost = 0;
  for (const row of breakdown) {
    if (remaining <= 0) break;
    const qty = Number(row.qty || 0);
    if (!(qty > 0)) continue;
    const used = Math.min(qty, remaining);
    const rowCost = Number(row.cost || 0);
    const unitCost = qty > 0 ? rowCost / qty : 0;
    cost += used * unitCost;
    remaining -= used;
  }
  return Number(cost.toFixed(4));
};

const createReplacementSale = async ({
  companyId,
  branchId,
  branchIsDefault = false,
  partyId,
  items = [],
  paymentType = "credit",
  bankAccountId,
  paidAmount = 0,
  invoiceDate,
}) => {
  const normalizedPaymentType = String(paymentType || "credit").toLowerCase();
  if (!["cash", "bank", "credit"].includes(normalizedPaymentType)) {
    throw new Error("Invalid replacement paymentType");
  }

  let bankId = null;
  if (normalizedPaymentType === "bank") {
    if (!bankAccountId) {
      throw new Error("bankAccountId is required for bank payments");
    }
    const bankAccount = await BankAccount.findOne({ _id: bankAccountId, companyId }).select("_id");
    if (!bankAccount) {
      throw new Error("Invalid bank account");
    }
    bankId = bankAccount._id;
  }

  let subtotal = 0;
  items.forEach((i) => {
    if (!i.productId || !i.quantity || !i.rate) {
      throw new Error("Invalid replacement item");
    }
    i.amount = i.quantity * i.rate;
    subtotal += i.amount;
  });

  const totalAmount = subtotal;
  const finalPaidAmount =
    normalizedPaymentType === "credit"
      ? Number(paidAmount || 0)
      : Number(totalAmount || 0);

  const count = await SalesInvoice.countDocuments({ companyId });
  const invoiceNo = `SAL-${count + 1}`;

  for (const item of items) {
      const { breakdown, actualCost } = await consumeBatches({
        companyId,
        branchId,
        branchIsDefault,
        productId: item.productId,
      quantity: item.quantity,
      asOfDate: invoiceDate || new Date(),
      sourceHint: "SALE_REPLACEMENT",
    });
    item.costBreakdown = breakdown;
    item.actualCost = Number(actualCost || 0);
    item.profitAmount = Number((item.amount - item.actualCost).toFixed(4));
  }

  const invoice = await SalesInvoice.create({
    companyId,
    branchId,
    partyId,
    paymentType: normalizedPaymentType,
    bankAccountId: bankId,
    invoiceNo,
    invoiceDate,
    items,
    subtotal,
    tax: 0,
    totalAmount,
    paidAmount: finalPaidAmount,
    pendingAmount: Math.max(0, totalAmount - finalPaidAmount),
    status:
      finalPaidAmount >= totalAmount
        ? "PAID"
        : finalPaidAmount > 0
          ? "PARTIAL"
          : "DUE",
  });

  for (const item of items) {
    await StockLedger.create({
      companyId,
      branchId,
      productId: item.productId,
      type: "SALE",
      quantity: item.quantity,
      rate: item.rate,
      referenceType: "SALES_INVOICE",
      referenceId: invoice._id,
    });
    await Product.updateOne(
      { _id: item.productId, companyId },
      { $set: { lastSalePrice: Number(item.rate || 0) } },
    );
  }

  if (partyId) {
    const party = await Party.findById(partyId);
    if (party) {
      party.balance = (party.balance || 0) + (totalAmount - finalPaidAmount);
      await party.save();
    }
  }

  if (finalPaidAmount > 0) {
    await Payment.create({
      companyId,
      branchId,
      partyId: partyId || undefined,
      invoiceType: "SALE",
      invoiceId: invoice._id,
      paymentType: "RECEIVED",
      amount: finalPaidAmount,
      paymentMode: normalizedPaymentType === "bank" ? "BANK" : "CASH",
      bankAccountId: bankId,
      remarks: "Replacement bill payment",
      paymentDate: invoice.invoiceDate || new Date(),
      adjustType: "bill",
    });
  }

  return invoice;
};

const createReplacementPurchase = async ({
  companyId,
  branchId,
  partyId,
  items = [],
  paymentType = "credit",
  bankAccountId,
  paidAmount = 0,
  invoiceNo,
  invoiceDate,
}) => {
  const normalizedPaymentType = String(paymentType || "credit").toLowerCase();
  if (!["cash", "bank", "credit"].includes(normalizedPaymentType)) {
    throw new Error("Invalid replacement paymentType");
  }

  const normalizedInvoiceNo = String(invoiceNo || "").trim();
  if (!normalizedInvoiceNo) {
    throw new Error("Replacement purchase bill number is required");
  }

  const duplicateInvoice = await PurchaseInvoice.findOne({
    companyId,
    invoiceNo: normalizedInvoiceNo,
  }).select("_id");
  if (duplicateInvoice) {
    throw new Error("Replacement purchase bill number already exists");
  }

  let bankId = null;
  if (normalizedPaymentType === "bank") {
    if (!bankAccountId) {
      throw new Error("bankAccountId is required for bank payments");
    }
    const bankAccount = await BankAccount.findOne({ _id: bankAccountId, companyId }).select("_id");
    if (!bankAccount) {
      throw new Error("Invalid bank account");
    }
    bankId = bankAccount._id;
  }

  let subtotal = 0;
  items.forEach((i) => {
    if (!i.productId || !i.quantity || !i.rate) {
      throw new Error("Invalid replacement item");
    }
    i.amount = i.quantity * i.rate;
    subtotal += i.amount;
  });

  const totalAmount = subtotal;
  const finalPaidAmount =
    normalizedPaymentType === "credit"
      ? Number(paidAmount || 0)
      : Number(totalAmount || 0);

  const invoice = await PurchaseInvoice.create({
    companyId,
    branchId,
    partyId,
    paymentType: normalizedPaymentType,
    bankAccountId: bankId,
    invoiceNo: normalizedInvoiceNo,
    invoiceDate,
    items,
    subtotal,
    tax: 0,
    totalAmount,
    paidAmount: finalPaidAmount,
    pendingAmount: Math.max(0, totalAmount - finalPaidAmount),
    status:
      finalPaidAmount >= totalAmount
        ? "PAID"
        : finalPaidAmount > 0
          ? "PARTIAL"
          : "DUE",
  });

  for (const item of items) {
    await StockLedger.create({
      companyId,
      branchId,
      productId: item.productId,
      type: "PURCHASE",
      quantity: item.quantity,
      rate: item.rate,
      referenceType: "PURCHASE_INVOICE",
      referenceId: invoice._id,
    });
    await StockBatch.create({
      companyId,
      branchId,
      productId: item.productId,
      sourceType: "PURCHASE",
      sourceId: invoice._id,
      totalQty: Number(item.quantity || 0),
      remainingQty: Number(item.quantity || 0),
      rate: Number(item.rate || 0),
    });
    await Product.updateOne(
      { _id: item.productId, companyId },
      { $set: { lastPurchaseRate: Number(item.rate || 0) } },
    );
  }

  if (partyId) {
    const party = await Party.findById(partyId);
    if (party) {
      party.balance = (party.balance || 0) + (totalAmount - finalPaidAmount);
      await party.save();
    }
  }

  if (finalPaidAmount > 0) {
    await Payment.create({
      companyId,
      branchId,
      partyId: partyId || undefined,
      invoiceType: "PURCHASE",
      invoiceId: invoice._id,
      paymentType: "PAID",
      amount: finalPaidAmount,
      paymentMode: normalizedPaymentType === "bank" ? "BANK" : "CASH",
      bankAccountId: bankId,
      remarks: "Replacement bill payment",
      paymentDate: invoice.invoiceDate || new Date(),
      adjustType: "bill",
    });
  }

  return invoice;
};

exports.createSaleReturn = async (req, res) => {
  try {
    const { billId, items, remarks, returnDate, replacement } = req.body;
    const companyId = req.user.companyId;

    const invoice = await SalesInvoice.findOne(
      withBranchScope(
        { _id: billId, companyId },
        req.user.branchId,
        req.user.branchIsDefault,
      ),
    );
    if (!invoice) {
      return res.status(404).json({ message: "Sales bill not found" });
    }

    validateItems(items);

    const previousReturns = await ReturnEntry.find(
      withBranchScope(
        {
          companyId,
          billType: "SALE",
          billId,
        },
        req.user.branchId,
        req.user.branchIsDefault,
      ),
    );
    const returnedMap = {};
    previousReturns.forEach((entry) => {
      entry.items.forEach((item) => {
        const key = String(item.productId);
        returnedMap[key] = (returnedMap[key] || 0) + Number(item.quantity || 0);
      });
    });

    for (const item of items) {
      const soldItem = invoice.items.find(
        (invItem) => String(invItem.productId) === String(item.productId),
      );
      if (!soldItem) {
        return res.status(400).json({ message: "Item not found in selected bill" });
      }
      const alreadyReturned = returnedMap[String(item.productId)] || 0;
      const maxAllowed = Number(soldItem.quantity || 0) - alreadyReturned;
      if (item.quantity > maxAllowed) {
        return res.status(400).json({
          message: `Return qty exceeds sold qty for product ${item.productId}`,
        });
      }
      if (!item.rate) {
        item.rate = Number(soldItem.rate || 0);
        item.amount = Number((item.quantity * item.rate).toFixed(2));
      }
    }

    for (const item of items) {
      const soldItem = invoice.items.find(
        (invItem) => String(invItem.productId) === String(item.productId),
      );
      if (soldItem && Array.isArray(soldItem.costBreakdown) && soldItem.costBreakdown.length) {
        await restoreBatchesFromBreakdown(companyId, req.user.branchId || null, soldItem.costBreakdown, item.quantity);
        item.costAmount = computeReturnCostFromBreakdown(
          soldItem.costBreakdown,
          item.quantity,
        );
      } else {
        await restoreByAverageCost(companyId, req.user.branchId || null, item.productId, item.quantity, returnDate || new Date(), req.user.branchIsDefault);
        const avgRate = await computeLedgerAverageCost(companyId, req.user.branchId || null, item.productId, returnDate || new Date(), req.user.branchIsDefault);
        item.costAmount = Number((avgRate * Number(item.quantity || 0)).toFixed(4));
      }
    }

    const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);
    const saleReturnCount = await ReturnEntry.countDocuments({
      companyId,
      returnType: "SALE_RETURN",
    });
    const returnNo = `SR-${saleReturnCount + 1}`;

    const returnEntry = await ReturnEntry.create({
      companyId,
      branchId: req.user.branchId || null,
      partyId: invoice.partyId,
      returnType: "SALE_RETURN",
      billType: "SALE",
      billId: invoice._id,
      originalSaleId: invoice._id,
      returnNo,
      returnDate,
      items,
      totalAmount,
      remarks,
    });

    for (const item of items) {
      await StockLedger.create({
        companyId,
        productId: item.productId,
        type: "SALE_RETURN",
        quantity: item.quantity,
        rate: item.rate,
        referenceType: "SALE_RETURN",
        referenceId: returnEntry._id,
        createdAt: returnDate || new Date(),
      });
    }

    const party = await Party.findById(invoice.partyId);
    if (party) {
      party.balance = Math.max(0, Number(party.balance || 0) - totalAmount);
      await party.save();
    }

    let replacementInvoice = null;
    let replacementError = null;
    if (replacement?.enabled && Array.isArray(replacement.items) && replacement.items.length) {
      try {
        replacementInvoice = await createReplacementSale({
          companyId,
          branchId: req.user.branchId || null,
          branchIsDefault: req.user.branchIsDefault,
          partyId: invoice.partyId,
          items: replacement.items,
          paymentType: replacement.paymentType,
          bankAccountId: replacement.bankAccountId,
          paidAmount: replacement.paidAmount,
          invoiceDate: returnDate,
        });
        returnEntry.hasReplacement = true;
        returnEntry.replacementBillId = replacementInvoice._id;
        returnEntry.replacementBillType = "SALE";
        returnEntry.netDifference = Number((replacementInvoice.totalAmount || 0) - totalAmount);
        await returnEntry.save();
      } catch (err) {
        replacementError = err.message;
      }
    }

    res.json({
      ...returnEntry.toObject(),
      replacementError,
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.createPurchaseReturn = async (req, res) => {
  try {
    const { billId, items, remarks, returnDate, returnNo, replacement } = req.body;
    const companyId = req.user.companyId;
    const normalizedReturnNo = String(returnNo || "").trim();

    if (!normalizedReturnNo) {
      return res.status(400).json({ message: "Purchase return number is required" });
    }

    const duplicateReturnNo = await ReturnEntry.findOne({
      companyId,
      returnType: "PURCHASE_RETURN",
      returnNo: normalizedReturnNo,
    }).select("_id");

    if (duplicateReturnNo) {
      return res.status(400).json({ message: "Purchase return number already exists" });
    }

    const invoice = await PurchaseInvoice.findOne(
      withBranchScope(
        { _id: billId, companyId },
        req.user.branchId,
        req.user.branchIsDefault,
      ),
    );
    if (!invoice) {
      return res.status(404).json({ message: "Purchase bill not found" });
    }

    validateItems(items);

    const previousReturns = await ReturnEntry.find(
      withBranchScope(
        {
          companyId,
          billType: "PURCHASE",
          billId,
        },
        req.user.branchId,
        req.user.branchIsDefault,
      ),
    );
    const returnedMap = {};
    previousReturns.forEach((entry) => {
      entry.items.forEach((item) => {
        const key = String(item.productId);
        returnedMap[key] = (returnedMap[key] || 0) + Number(item.quantity || 0);
      });
    });

    for (const item of items) {
      const purchasedItem = invoice.items.find(
        (invItem) => String(invItem.productId) === String(item.productId),
      );
      if (!purchasedItem) {
        return res.status(400).json({ message: "Item not found in selected bill" });
      }
      const alreadyReturned = returnedMap[String(item.productId)] || 0;
      const maxAllowed = Number(purchasedItem.quantity || 0) - alreadyReturned;
      if (item.quantity > maxAllowed) {
        return res.status(400).json({
          message: `Return qty exceeds purchased qty for product ${item.productId}`,
        });
      }
      if (!item.rate) {
        item.rate = Number(purchasedItem.rate || 0);
        item.amount = Number((item.quantity * item.rate).toFixed(2));
      }

      const availableStock = await getAvailableStock(companyId, req.user.branchId || null, item.productId, new Date(), req.user.branchIsDefault);
      if (availableStock < item.quantity) {
        return res.status(400).json({
          message: `Insufficient stock for purchase return. Available: ${availableStock}`,
        });
      }
    }

    for (const item of items) {
      try {
        await consumePurchaseBatches(companyId, req.user.branchId || null, item.productId, invoice._id, item.quantity, req.user.branchIsDefault);
      } catch (err) {
        await consumeBatches({
          companyId,
          branchId: req.user.branchId || null,
          productId: item.productId,
          quantity: item.quantity,
          asOfDate: returnDate || new Date(),
          sourceHint: "PURCHASE_RETURN_FALLBACK",
        });
      }
    }

    const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);

    const returnEntry = await ReturnEntry.create({
      companyId,
      branchId: req.user.branchId || null,
      partyId: invoice.partyId,
      returnType: "PURCHASE_RETURN",
      billType: "PURCHASE",
      billId: invoice._id,
      originalPurchaseId: invoice._id,
      returnNo: normalizedReturnNo,
      returnDate,
      items,
      totalAmount,
      remarks,
    });

    for (const item of items) {
      await StockLedger.create({
        companyId,
        productId: item.productId,
        type: "PURCHASE_RETURN",
        quantity: item.quantity,
        rate: item.rate,
        referenceType: "PURCHASE_RETURN",
        referenceId: returnEntry._id,
        createdAt: returnDate || new Date(),
      });
    }

    const party = await Party.findById(invoice.partyId);
    if (party) {
      party.balance = Math.max(0, Number(party.balance || 0) - totalAmount);
      await party.save();
    }

    let replacementInvoice = null;
    let replacementError = null;
    if (replacement?.enabled && Array.isArray(replacement.items) && replacement.items.length) {
      try {
        replacementInvoice = await createReplacementPurchase({
          companyId,
          branchId: req.user.branchId || null,
          partyId: invoice.partyId,
          items: replacement.items,
          paymentType: replacement.paymentType,
          bankAccountId: replacement.bankAccountId,
          paidAmount: replacement.paidAmount,
          invoiceNo: replacement.invoiceNo,
          invoiceDate: returnDate,
        });
        returnEntry.hasReplacement = true;
        returnEntry.replacementBillId = replacementInvoice._id;
        returnEntry.replacementBillType = "PURCHASE";
        returnEntry.netDifference = Number((replacementInvoice.totalAmount || 0) - totalAmount);
        await returnEntry.save();
      } catch (err) {
        replacementError = err.message;
      }
    }

    res.json({
      ...returnEntry.toObject(),
      replacementError,
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.getReturnBills = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const returnType = normalizeReturnType(req.query.returnType || req.query.type);
    const BillModel = getBillModelByReturnType(returnType);
    const query = { companyId };

    const dateRange = getDateRangeFromQuery(req.query);
    if (dateRange) {
      query.invoiceDate = { $gte: dateRange.fromDate, $lte: dateRange.toDate };
    }

    if (req.query.partyId) {
      query.partyId = req.query.partyId;
    }

    const bills = await BillModel.find(query)
      .populate("partyId", "name")
      .sort({ invoiceDate: -1, createdAt: -1 })
      .select("_id invoiceNo invoiceDate totalAmount paidAmount status partyId items");

    res.json(
      bills.map((bill) => ({
        _id: bill._id,
        invoiceNo: bill.invoiceNo,
        invoiceDate: bill.invoiceDate,
        totalAmount: bill.totalAmount,
        paidAmount: bill.paidAmount,
        status: bill.status,
        partyId: bill.partyId,
        itemCount: Array.isArray(bill.items) ? bill.items.length : 0,
      })),
    );
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getReturnBillItems = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const returnType = normalizeReturnType(req.query.returnType || req.query.type);
    const BillModel = getBillModelByReturnType(returnType);
    const billType = returnType === "PURCHASE_RETURN" ? "PURCHASE" : "SALE";
    const billId = req.params.billId;

    const bill = await BillModel.findOne(
      withBranchScope(
        { _id: billId, companyId },
        req.user.branchId,
        req.user.branchIsDefault,
      ),
    )
      .populate("partyId", "name")
      .populate("items.productId", "name");

    if (!bill) {
      return res.status(404).json({ message: "Bill not found" });
    }

    const previousReturns = await ReturnEntry.find(
      withBranchScope(
        {
          companyId,
          billType,
          billId,
        },
        req.user.branchId,
        req.user.branchIsDefault,
      ),
    ).select("items.productId items.quantity");

    const returnedMap = {};
    previousReturns.forEach((entry) => {
      entry.items.forEach((item) => {
        const key = String(item.productId);
        returnedMap[key] = (returnedMap[key] || 0) + Number(item.quantity || 0);
      });
    });

    const items = (bill.items || []).map((item) => {
      const productId = item.productId?._id || item.productId;
      const originalQty = Number(item.quantity || 0);
      const returnedQty = Number(returnedMap[String(productId)] || 0);
      const remainingQty = Math.max(0, originalQty - returnedQty);
      return {
        productId,
        productName: item.productId?.name || "Unknown Product",
        rate: Number(item.rate || 0),
        originalQty,
        returnedQty,
        remainingQty,
      };
    });

    res.json({
      bill: {
        _id: bill._id,
        invoiceNo: bill.invoiceNo,
        invoiceDate: bill.invoiceDate,
        totalAmount: bill.totalAmount,
        paidAmount: bill.paidAmount,
        status: bill.status,
        partyId: bill.partyId,
      },
      items,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getReturns = async (req, res) => {
  const status = String(req.query.status || "active").toLowerCase();
  const query = withBranchScope(
    {
      companyId: req.user.companyId,
      ...(status === "deleted" ? { isDeleted: true } : {}),
    },
    req.user.branchId,
    req.user.branchIsDefault,
  );
  if (req.query.billId) query.billId = req.query.billId;
  if (req.query.billType) query.billType = req.query.billType;
  const range = getDateRangeFromQuery(req.query);
  if (range) {
    query.returnDate = { $gte: range.fromDate, $lte: range.toDate };
  }

  const withDeleted = status === "deleted" || status === "all";
  const data = await ReturnEntry.find(query)
    .setOptions({ withDeleted })
    .populate("partyId", "name")
    .populate("items.productId", "name")
    .sort({ returnDate: -1, createdAt: -1 });

  res.json(data);
};

exports.deleteReturn = async (req, res) => {
  try {
    const entry = await ReturnEntry.findOne(
      withBranchScope(
        { _id: req.params.id, companyId: req.user.companyId },
        req.user.branchId,
        req.user.branchIsDefault,
      ),
    );

    if (!entry) {
      return res.status(404).json({ message: "Return entry not found" });
    }

    if (entry.replacementBillId) {
      return res.status(400).json({
        message: "Delete linked replacement bill first before deleting this return",
      });
    }

    if (entry.returnType === "SALE_RETURN") {
      const invoice = await SalesInvoice.findOne({
        _id: entry.billId,
        companyId: req.user.companyId,
      }).setOptions({ withDeleted: true });

      if (!invoice) {
        return res.status(400).json({ message: "Original sale invoice not found" });
      }

      for (const item of entry.items || []) {
        const saleItem = (invoice.items || []).find(
          (row) => String(row.productId) === String(item.productId),
        );
        if (saleItem?.costBreakdown?.length) {
          await consumeSpecificBatchBreakdown(
            req.user.companyId,
            saleItem.costBreakdown,
            item.quantity,
          );
        } else {
          const availableStock = await getAvailableStock(req.user.companyId, req.user.branchId || null, item.productId, new Date(), req.user.branchIsDefault);
          if (availableStock < Number(item.quantity || 0)) {
            return res.status(400).json({
              message: "Return stock has already been used and cannot be deleted",
            });
          }
          await consumeBatches({
            companyId: req.user.companyId,
            branchId: req.user.branchId || null,
            productId: item.productId,
            quantity: item.quantity,
            asOfDate: entry.returnDate || new Date(),
            sourceHint: "SALE_RETURN_DELETE",
          });
        }
      }
    } else {
      for (const item of entry.items || []) {
        await restorePurchaseBatches(
          req.user.companyId,
          entry.billId,
          item.productId,
          item.quantity,
        );
      }
    }

    const directLedgerCount = await StockLedger.countDocuments({
      companyId: req.user.companyId,
      referenceType: entry.returnType,
      referenceId: entry._id,
      type: entry.returnType,
    });

    if (!directLedgerCount) {
      const siblingReturns = await ReturnEntry.countDocuments({
        companyId: req.user.companyId,
        billId: entry.billId,
        returnType: entry.returnType,
        _id: { $ne: entry._id },
      });
      if (siblingReturns > 0) {
        return res.status(400).json({
          message: "This legacy return cannot be deleted safely because it shares stock history with other returns",
        });
      }
    }

    await StockLedger.deleteMany({
      companyId: req.user.companyId,
      referenceType: entry.returnType,
      referenceId: directLedgerCount ? entry._id : entry.billId,
      type: entry.returnType,
    });

    if (entry.partyId) {
      const party = await Party.findById(entry.partyId);
      if (party) {
        party.balance = Number(party.balance || 0) + Number(entry.totalAmount || 0);
        await party.save();
      }
    }

    entry.isDeleted = true;
    entry.deletedAt = new Date();
    entry.deletedBy = req.user._id || null;
    await entry.save();

    res.json({ message: "Return entry deleted successfully" });
  } catch (err) {
    res.status(400).json({ message: err.message || "Failed to delete return entry" });
  }
};

exports.restoreReturn = async (req, res) => {
  try {
    const entry = await ReturnEntry.findOne(
      withBranchScope(
        {
          _id: req.params.id,
          companyId: req.user.companyId,
          isDeleted: true,
        },
        req.user.branchId,
        req.user.branchIsDefault,
      ),
    ).setOptions({ withDeleted: true });

    if (!entry) {
      return res.status(404).json({ message: "Deleted return entry not found" });
    }

    if (entry.replacementBillId) {
      return res.status(400).json({
        message: "Restore the return through the linked replacement flow is not supported yet",
      });
    }

    if (entry.returnType === "SALE_RETURN") {
      const invoice = await SalesInvoice.findOne(
        withBranchScope(
          {
            _id: entry.billId,
            companyId: req.user.companyId,
          },
          req.user.branchId,
          req.user.branchIsDefault,
        ),
      ).setOptions({ withDeleted: true });

      if (!invoice) {
        return res.status(400).json({ message: "Original sale invoice not found" });
      }

      const activeReturns = await ReturnEntry.find(
        withBranchScope(
          {
            companyId: req.user.companyId,
            billType: "SALE",
            billId: entry.billId,
            isDeleted: { $ne: true },
          },
          req.user.branchId,
          req.user.branchIsDefault,
        ),
      ).select("items.productId items.quantity");

      const returnedMap = {};
      activeReturns.forEach((returnEntry) => {
        (returnEntry.items || []).forEach((item) => {
          const key = String(item.productId);
          returnedMap[key] = (returnedMap[key] || 0) + Number(item.quantity || 0);
        });
      });

      for (const item of entry.items || []) {
        const soldItem = (invoice.items || []).find(
          (invItem) => String(invItem.productId) === String(item.productId),
        );
        if (!soldItem) {
          throw new Error("Item not found in selected bill");
        }

        const alreadyReturned = returnedMap[String(item.productId)] || 0;
        const maxAllowed = Number(soldItem.quantity || 0) - alreadyReturned;
        if (Number(item.quantity || 0) > maxAllowed) {
          throw new Error("Return qty exceeds sold qty after restore");
        }

        if (soldItem.costBreakdown?.length) {
          await restoreBatchesFromBreakdown(
            req.user.companyId,
            soldItem.costBreakdown,
            item.quantity,
          );
        } else {
          await restoreByAverageCost(
            req.user.companyId,
            req.user.branchId || null,
            item.productId,
            item.quantity,
            entry.returnDate || new Date(),
            req.user.branchIsDefault,
          );
        }
      }
    } else {
      for (const item of entry.items || []) {
        const availableStock = await getAvailableStock(req.user.companyId, req.user.branchId || null, item.productId, new Date(), req.user.branchIsDefault);
        if (availableStock < Number(item.quantity || 0)) {
          throw new Error("Insufficient stock to restore this purchase return");
        }
        try {
          await consumePurchaseBatches(req.user.companyId, req.user.branchId || null, item.productId, entry.billId, item.quantity, req.user.branchIsDefault);
        } catch (err) {
          await consumeBatches({
            companyId: req.user.companyId,
            branchId: req.user.branchId || null,
            productId: item.productId,
            quantity: item.quantity,
            asOfDate: entry.returnDate || new Date(),
            sourceHint: "PURCHASE_RETURN_RESTORE",
          });
        }
      }
    }

    for (const item of entry.items || []) {
      await StockLedger.create({
        companyId: req.user.companyId,
        productId: item.productId,
        type: entry.returnType,
        quantity: item.quantity,
        rate: item.rate,
        referenceType: entry.returnType,
        referenceId: entry._id,
        createdAt: entry.returnDate || entry.createdAt || new Date(),
      });
    }

    if (entry.partyId) {
      const party = await Party.findById(entry.partyId);
      if (party) {
        party.balance = Math.max(0, Number(party.balance || 0) - Number(entry.totalAmount || 0));
        await party.save();
      }
    }

    entry.isDeleted = false;
    entry.deletedAt = null;
    entry.deletedBy = null;
    await entry.save();

    res.json(entry);
  } catch (err) {
    res.status(400).json({ message: err.message || "Failed to restore return entry" });
  }
};
