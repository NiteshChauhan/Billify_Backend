const StockLedger = require("../models/StockLedger");

exports.getAvailableStock = async (companyId, productId) => {
  const entries = await StockLedger.find({ companyId, productId });

  let stock = 0;

  entries.forEach(e => {
    if (["PURCHASE", "OPENING", "SALE_RETURN"].includes(e.type)) {
      stock += e.quantity;
    } else {
      stock -= e.quantity;
    }
  });

  return stock;
};
