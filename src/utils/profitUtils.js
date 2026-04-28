const Payment = require("../models/Payment");
const Product = require("../models/Product");
const ReturnEntry = require("../models/Return");
const SalesInvoice = require("../models/SalesInvoice");
const StockLedger = require("../models/StockLedger");
const { computeLedgerAverageCost } = require("./stockUtils");
const { withBranchScope } = require("./branchScope");

const round2 = (value) => Number(Number(value || 0).toFixed(2));

const computeEntryCost = async (companyId, branchId, saleEntry, branchIsDefault = false) => {
  const stockEntries = await StockLedger.find({
    ...withBranchScope({ companyId, productId: saleEntry.productId }, branchId, branchIsDefault),
    type: { $in: ["PURCHASE", "OPENING", "PURCHASE_RETURN"] },
    createdAt: { $lte: saleEntry.createdAt },
  });

  const totalQty = stockEntries.reduce(
    (sum, entry) =>
      sum + Number(entry.quantity || 0) * (entry.type === "PURCHASE_RETURN" ? -1 : 1),
    0,
  );

  const totalValue = stockEntries.reduce(
    (sum, entry) =>
      sum +
      Number(entry.quantity || 0) *
        Number(entry.rate || 0) *
        (entry.type === "PURCHASE_RETURN" ? -1 : 1),
    0,
  );

  return totalQty > 0 ? totalValue / totalQty : 0;
};

const buildSaleInvoiceMetrics = async (companyId, branchId, invoices = [], branchIsDefault = false) => {
  if (!invoices.length) {
    return new Map();
  }

  const invoiceMetrics = new Map();
  const legacyInvoiceIds = [];

  for (const invoice of invoices) {
    const items = Array.isArray(invoice.items) ? invoice.items : [];
    const hasCost =
      items.some(
        (item) =>
          Number(item.actualCost || 0) > 0 ||
          (Array.isArray(item.costBreakdown) && item.costBreakdown.length),
      );

    if (!hasCost) {
      legacyInvoiceIds.push(invoice._id);
      continue;
    }

    const current = {
      saleAmount: 0,
      costAmount: 0,
      productNames: new Set(),
      quantity: 0,
    };

    for (const item of items) {
      const quantity = Number(item.quantity || 0);
      const saleRate = Number(item.rate || 0);
      const amount = Number(item.amount || quantity * saleRate);
      const costFromBreakdown = Array.isArray(item.costBreakdown)
        ? item.costBreakdown.reduce((sum, row) => sum + Number(row.cost || 0), 0)
        : 0;
      const actualCost = Number(item.actualCost || costFromBreakdown || 0);

      current.saleAmount += amount;
      current.costAmount += actualCost;
      current.quantity += quantity;

      const productName = item.productId?.name;
      if (productName) {
        current.productNames.add(productName);
      }
    }

    invoiceMetrics.set(String(invoice._id), current);
  }

  if (!legacyInvoiceIds.length) {
    return invoiceMetrics;
  }

  const saleEntries = await StockLedger.find({
    ...withBranchScope({ companyId }, branchId, branchIsDefault),
    type: "SALE",
    referenceId: { $in: legacyInvoiceIds },
  }).sort({ createdAt: 1 });

  const productIds = [...new Set(saleEntries.map((entry) => String(entry.productId)).filter(Boolean))];
  const products = productIds.length
    ? await Product.find({ companyId, _id: { $in: productIds } }).select("_id name")
    : [];
  const productMap = new Map(products.map((product) => [String(product._id), product.name]));

  for (const entry of saleEntries) {
    const avgCost = await computeEntryCost(companyId, branchId, entry, branchIsDefault);
    const invoiceId = String(entry.referenceId);
    const current = invoiceMetrics.get(invoiceId) || {
      saleAmount: 0,
      costAmount: 0,
      productNames: new Set(),
      quantity: 0,
    };

    const quantity = Number(entry.quantity || 0);
    const saleRate = Number(entry.rate || 0);
    current.saleAmount += quantity * saleRate;
    current.costAmount += quantity * avgCost;
    current.quantity += quantity;
    const productName = productMap.get(String(entry.productId));
    if (productName) {
      current.productNames.add(productName);
    }

    invoiceMetrics.set(invoiceId, current);
  }

  return invoiceMetrics;
};

const computeReturnItemCost = async (companyId, branchId, saleItem, returnQty, returnDate, branchIsDefault = false) => {
  const qty = Number(returnQty || 0);
  if (!(qty > 0)) return 0;
  const breakdown = Array.isArray(saleItem.costBreakdown) ? saleItem.costBreakdown : [];
  if (breakdown.length) {
    let remaining = qty;
    let cost = 0;
    for (const row of breakdown) {
      if (remaining <= 0) break;
      const rowQty = Number(row.qty || 0);
      if (!(rowQty > 0)) continue;
      const used = Math.min(rowQty, remaining);
      const rowCost = Number(row.cost || 0);
      const unitCost = rowQty > 0 ? rowCost / rowQty : 0;
      cost += used * unitCost;
      remaining -= used;
    }
    return Number(cost.toFixed(4));
  }

  const actualCost = Number(saleItem.actualCost || 0);
  const soldQty = Number(saleItem.quantity || 0);
  if (soldQty > 0 && actualCost > 0) {
    return Number(((actualCost / soldQty) * qty).toFixed(4));
  }

  const avgRate = await computeLedgerAverageCost(companyId, branchId, saleItem.productId, returnDate || new Date(), branchIsDefault);
  return Number((avgRate * qty).toFixed(4));
};

exports.getProfitSummary = async (companyId, fromDate, toDate, branchId = null, options = {}) => {
  const { includeEntries = false } = options;
  const branchIsDefault = Boolean(options.branchIsDefault);

  const paidSales = await SalesInvoice.find({
    ...withBranchScope({ companyId }, branchId, branchIsDefault),
    status: "PAID",
  })
    .populate("partyId", "name")
    .populate("items.productId", "name")
    .select("_id invoiceNo invoiceDate totalAmount paidAmount paymentType partyId items");

  const invoiceIds = paidSales.map((invoice) => invoice._id);
  const saleMetricsMap = await buildSaleInvoiceMetrics(companyId, branchId, paidSales, branchIsDefault);

  const payments = invoiceIds.length
      ? await Payment.find({
        ...withBranchScope({ companyId }, branchId, branchIsDefault),
        invoiceType: "SALE",
        invoiceId: { $in: invoiceIds },
        paymentType: "RECEIVED",
        adjustType: "bill",
      }).sort({ paymentDate: 1, createdAt: 1 })
    : [];

  const paymentMap = new Map();
  payments.forEach((payment) => {
    const key = String(payment.invoiceId);
    const current = paymentMap.get(key) || [];
    current.push(payment);
    paymentMap.set(key, current);
  });

  let totalSales = 0;
  let totalCost = 0;
  const dailyMap = {};
  const entries = [];

  for (const invoice of paidSales) {
    const invoiceKey = String(invoice._id);
    const metrics = saleMetricsMap.get(invoiceKey);
    if (!metrics || !(metrics.saleAmount > 0)) {
      continue;
    }

    const invoicePayments = paymentMap.get(invoiceKey) || [];
    const finalPayment = invoicePayments[invoicePayments.length - 1];
    const realizedDate =
      finalPayment?.paymentDate ||
      ((invoice.paymentType === "cash" || invoice.paymentType === "bank") &&
      Number(invoice.paidAmount || 0) >= Number(invoice.totalAmount || 0)
        ? invoice.invoiceDate
        : null);

    if (!realizedDate) {
      continue;
    }

    if (realizedDate < fromDate || realizedDate > toDate) {
      continue;
    }

    const saleAmount = round2(metrics.saleAmount);
    const costAmount = round2(metrics.costAmount);
    const profitAmount = round2(saleAmount - costAmount);
    totalSales += saleAmount;
    totalCost += costAmount;

    const dayKey = new Date(realizedDate).toISOString().slice(0, 10);
    if (!dailyMap[dayKey]) {
      dailyMap[dayKey] = { date: dayKey, sales: 0, cost: 0, profit: 0 };
    }
    dailyMap[dayKey].sales += saleAmount;
    dailyMap[dayKey].cost += costAmount;
    dailyMap[dayKey].profit += profitAmount;

    if (includeEntries) {
      entries.push({
        date: realizedDate,
        invoiceNo: invoice.invoiceNo || "-",
        partyName: invoice.partyId?.name || "Cash",
        productName: [...metrics.productNames].join(", ") || "Products",
        quantity: round2(metrics.quantity),
        salePrice: saleAmount,
        costPrice: costAmount,
        profit: profitAmount,
      });
    }
  }

  const paidSalesMap = new Map(paidSales.map((invoice) => [String(invoice._id), invoice]));
  const saleReturns = await ReturnEntry.find({
    ...withBranchScope({ companyId }, branchId, branchIsDefault),
    returnType: "SALE_RETURN",
    returnDate: { $gte: fromDate, $lte: toDate },
  })
    .populate("partyId", "name")
    .populate("items.productId", "name");

  for (const ret of saleReturns) {
    const saleInvoice = paidSalesMap.get(String(ret.billId));
    if (!saleInvoice) {
      continue;
    }

    let returnSaleAmount = 0;
    let returnCostAmount = 0;
    let returnQty = 0;
    const productNames = new Set();

    for (const item of ret.items || []) {
      const qty = Number(item.quantity || 0);
      const amount = Number(item.amount || qty * Number(item.rate || 0));
      returnSaleAmount += amount;
      returnQty += qty;

      const saleItem = (saleInvoice.items || []).find(
        (row) => String(row.productId?._id || row.productId) === String(item.productId?._id || item.productId),
      );
      if (saleItem) {
        returnCostAmount += await computeReturnItemCost(companyId, branchId, saleItem, qty, ret.returnDate, branchIsDefault);
      } else {
        const avgRate = await computeLedgerAverageCost(companyId, branchId, item.productId, ret.returnDate, branchIsDefault);
        returnCostAmount += avgRate * qty;
      }

      const productName = item.productId?.name;
      if (productName) {
        productNames.add(productName);
      }
    }

    if (!(returnSaleAmount > 0)) continue;

    const saleAmount = round2(returnSaleAmount);
    const costAmount = round2(returnCostAmount);
    const profitAmount = round2(saleAmount - costAmount);

    totalSales -= saleAmount;
    totalCost -= costAmount;

    const dayKey = new Date(ret.returnDate).toISOString().slice(0, 10);
    if (!dailyMap[dayKey]) {
      dailyMap[dayKey] = { date: dayKey, sales: 0, cost: 0, profit: 0 };
    }
    dailyMap[dayKey].sales -= saleAmount;
    dailyMap[dayKey].cost -= costAmount;
    dailyMap[dayKey].profit -= profitAmount;

    if (includeEntries) {
      entries.push({
        date: ret.returnDate,
        invoiceNo: ret.returnNo || "RETURN",
        partyName: ret.partyId?.name || "Cash",
        productName: [...productNames].join(", ") || "Products",
        quantity: round2(returnQty),
        salePrice: -saleAmount,
        costPrice: -costAmount,
        profit: -profitAmount,
      });
    }
  }

  const daily = Object.values(dailyMap)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row) => ({
      date: row.date,
      sales: round2(row.sales),
      cost: round2(row.cost),
      profit: round2(row.profit),
    }));

  const result = {
    sales: round2(totalSales),
    cost: round2(totalCost),
    profit: round2(totalSales - totalCost),
    daily,
  };

  if (includeEntries) {
    result.entries = entries.sort((a, b) => new Date(a.date) - new Date(b.date));
  }

  return result;
};
