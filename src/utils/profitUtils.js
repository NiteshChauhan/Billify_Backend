const StockLedger = require("../models/StockLedger");

exports.getProfitSummary = async (companyId, fromDate, toDate) => {

  // 1️⃣ Fetch all SALES in range
  const sales = await StockLedger.find({
    companyId,
    type: "SALE",
    createdAt: { $gte: fromDate, $lte: toDate },
  });

  let totalSales = 0;
  let totalCost = 0;

  for (const sale of sales) {

    // 2️⃣ Fetch all PURCHASE + OPENING till sale date
    const stockEntries = await StockLedger.find({
      companyId,
      productId: sale.productId,
      type: { $in: ["PURCHASE", "OPENING"] },
      createdAt: { $lte: sale.createdAt },
    });

    const totalQty = stockEntries.reduce(
      (sum, entry) => sum + Number(entry.quantity || 0),
      0
    );

    const totalValue = stockEntries.reduce(
      (sum, entry) =>
        sum + Number(entry.quantity || 0) * Number(entry.rate || 0),
      0
    );

    const avgCost = totalQty > 0 ? totalValue / totalQty : 0;

    totalSales += Number(sale.quantity) * Number(sale.rate);
    totalCost += Number(sale.quantity) * avgCost;
  }

  return {
    sales: Number(totalSales.toFixed(2)),
    cost: Number(totalCost.toFixed(2)),
    profit: Number((totalSales - totalCost).toFixed(2)),
  };
};