const Company = require("../models/Company");
const Product = require("../models/Product");
const { getAvailableStock } = require("./stockUtils");

exports.validateStockForSale = async (companyId, items) => {
  const company = await Company.findById(companyId).select("stockSettlementEnabled");
  const stockSettlementEnabled = Boolean(company?.stockSettlementEnabled);

  if (!stockSettlementEnabled) {
    return { stockSettlementEnabled };
  }

  const productIds = [...new Set((items || []).map((item) => String(item.productId || "")).filter(Boolean))];
  const products = await Product.find({
    _id: { $in: productIds },
    companyId,
  }).select("name");
  const productMap = new Map(products.map((product) => [String(product._id), product]));

  for (const item of items) {
    const available = await getAvailableStock(companyId, item.productId);
    if (available < item.quantity) {
      const error = new Error("Insufficient stock");
      error.code = "INSUFFICIENT_STOCK";
      error.productId = item.productId;
      error.productName = productMap.get(String(item.productId))?.name || "Product";
      error.availableStock = available;
      throw error;
    }
  }

  return { stockSettlementEnabled };
};
