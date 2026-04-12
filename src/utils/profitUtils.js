const Payment = require("../models/Payment");
const Product = require("../models/Product");
const SalesInvoice = require("../models/SalesInvoice");
const StockLedger = require("../models/StockLedger");

const round2 = (value) => Number(Number(value || 0).toFixed(2));

const computeEntryCost = async (companyId, saleEntry) => {
  const stockEntries = await StockLedger.find({
    companyId,
    productId: saleEntry.productId,
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

const buildSaleInvoiceMetrics = async (companyId, invoices = []) => {
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
    companyId,
    type: "SALE",
    referenceId: { $in: legacyInvoiceIds },
  }).sort({ createdAt: 1 });

  const productIds = [...new Set(saleEntries.map((entry) => String(entry.productId)).filter(Boolean))];
  const products = productIds.length
    ? await Product.find({ companyId, _id: { $in: productIds } }).select("_id name")
    : [];
  const productMap = new Map(products.map((product) => [String(product._id), product.name]));

  for (const entry of saleEntries) {
    const avgCost = await computeEntryCost(companyId, entry);
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

exports.getProfitSummary = async (companyId, fromDate, toDate, options = {}) => {
  const { includeEntries = false } = options;

  const paidSales = await SalesInvoice.find({
    companyId,
    status: "PAID",
  })
    .populate("partyId", "name")
    .populate("items.productId", "name")
    .select("_id invoiceNo invoiceDate totalAmount paidAmount paymentType partyId items");

  const invoiceIds = paidSales.map((invoice) => invoice._id);
  const saleMetricsMap = await buildSaleInvoiceMetrics(companyId, paidSales);

  const payments = invoiceIds.length
    ? await Payment.find({
        companyId,
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
