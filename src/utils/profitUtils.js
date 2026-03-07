const StockLedger = require("../models/StockLedger");

exports.getProfitSummary = async (companyId, fromDate, toDate) => {

  // 1️⃣ Fetch all SALES in range
  const sales = await StockLedger.find({
    companyId,
    type: { $in: ["SALE", "SALE_RETURN"] },
    createdAt: { $gte: fromDate, $lte: toDate },
  });

  let totalSales = 0;
  let totalCost = 0;
  const dailyMap = {};

  for (const sale of sales) {

    // 2️⃣ Fetch all PURCHASE + OPENING till sale date
    const stockEntries = await StockLedger.find({
      companyId,
      productId: sale.productId,
      type: { $in: ["PURCHASE", "OPENING", "PURCHASE_RETURN"] },
      createdAt: { $lte: sale.createdAt },
    });

    const totalQty = stockEntries.reduce(
      (sum, entry) =>
        sum +
        Number(entry.quantity || 0) *
          (entry.type === "PURCHASE_RETURN" ? -1 : 1),
      0
    );

    const totalValue = stockEntries.reduce(
      (sum, entry) =>
        sum +
        Number(entry.quantity || 0) *
          Number(entry.rate || 0) *
          (entry.type === "PURCHASE_RETURN" ? -1 : 1),
      0
    );

    const avgCost = totalQty > 0 ? totalValue / totalQty : 0;

    const direction = sale.type === "SALE_RETURN" ? -1 : 1;
    const saleValue = Number(sale.quantity) * Number(sale.rate) * direction;
    const costValue = Number(sale.quantity) * avgCost * direction;
    totalSales += saleValue;
    totalCost += costValue;

    const dayKey = new Date(sale.createdAt).toISOString().slice(0, 10);
    if (!dailyMap[dayKey]) {
      dailyMap[dayKey] = { date: dayKey, sales: 0, cost: 0, profit: 0 };
    }
    dailyMap[dayKey].sales += saleValue;
    dailyMap[dayKey].cost += costValue;
    dailyMap[dayKey].profit += saleValue - costValue;
  }

  const daily = Object.values(dailyMap)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row) => ({
      date: row.date,
      sales: Number(row.sales.toFixed(2)),
      cost: Number(row.cost.toFixed(2)),
      profit: Number(row.profit.toFixed(2)),
    }));

  return {
    sales: Number(totalSales.toFixed(2)),
    cost: Number(totalCost.toFixed(2)),
    profit: Number((totalSales - totalCost).toFixed(2)),
    daily,
  };
};
