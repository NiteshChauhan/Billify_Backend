const StockLedger = require("../models/StockLedger");
const Product = require("../models/Product");

exports.getProfitSummary = async (companyId, fromDate, toDate, options = {}) => {
  const { includeEntries = false } = options;

  const sales = await StockLedger.find({
    companyId,
    type: { $in: ["SALE", "SALE_RETURN"] },
    createdAt: { $gte: fromDate, $lte: toDate },
  });

  const productIds = [...new Set(sales.map((row) => String(row.productId)).filter(Boolean))];
  const products = await Product.find({
    companyId,
    _id: { $in: productIds },
  }).select("_id name");
  const productMap = Object.fromEntries(products.map((p) => [String(p._id), p.name]));

  let totalSales = 0;
  let totalCost = 0;
  const dailyMap = {};
  const entries = [];

  for (const sale of sales) {
    const stockEntries = await StockLedger.find({
      companyId,
      productId: sale.productId,
      type: { $in: ["PURCHASE", "OPENING", "PURCHASE_RETURN"] },
      createdAt: { $lte: sale.createdAt },
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

    const avgCost = totalQty > 0 ? totalValue / totalQty : 0;

    const direction = sale.type === "SALE_RETURN" ? -1 : 1;
    const quantity = Number(sale.quantity || 0);
    const saleRate = Number(sale.rate || 0);
    const saleValue = quantity * saleRate * direction;
    const costValue = quantity * avgCost * direction;

    totalSales += saleValue;
    totalCost += costValue;

    const dayKey = new Date(sale.createdAt).toISOString().slice(0, 10);
    if (!dailyMap[dayKey]) {
      dailyMap[dayKey] = { date: dayKey, sales: 0, cost: 0, profit: 0 };
    }

    dailyMap[dayKey].sales += saleValue;
    dailyMap[dayKey].cost += costValue;
    dailyMap[dayKey].profit += saleValue - costValue;

    if (includeEntries) {
      entries.push({
        date: sale.createdAt,
        type: sale.type,
        productId: sale.productId,
        productName: productMap[String(sale.productId)] || "Unknown Product",
        quantity: direction > 0 ? quantity : -quantity,
        costPrice: Number(avgCost.toFixed(2)),
        salePrice: saleRate,
        profit: Number((saleValue - costValue).toFixed(2)),
      });
    }
  }

  const daily = Object.values(dailyMap)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row) => ({
      date: row.date,
      sales: Number(row.sales.toFixed(2)),
      cost: Number(row.cost.toFixed(2)),
      profit: Number(row.profit.toFixed(2)),
    }));

  const result = {
    sales: Number(totalSales.toFixed(2)),
    cost: Number(totalCost.toFixed(2)),
    profit: Number((totalSales - totalCost).toFixed(2)),
    daily,
  };

  if (includeEntries) {
    result.entries = entries.sort((a, b) => new Date(a.date) - new Date(b.date));
  }

  return result;
};
