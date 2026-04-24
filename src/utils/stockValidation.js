const Product = require("../models/Product");
const { getAvailableStock } = require("./stockUtils");

exports.validateStockForSale = async (companyId, items) => {
  const productIds = [...new Set((items || []).map((item) => String(item.productId || "")).filter(Boolean))];
  const products = await Product.find({
    _id: { $in: productIds },
    companyId,
  }).select("name stockMode");
  const productMap = new Map(products.map((product) => [String(product._id), product]));

  for (const item of items) {
    const product = productMap.get(String(item.productId));
    const stockMode = String(product?.stockMode || "flexible").toLowerCase();
    const available = await getAvailableStock(companyId, item.productId);
    if (stockMode === "locked" && available < item.quantity) {
      const error = new Error("Insufficient stock");
      error.code = "INSUFFICIENT_STOCK";
      error.productId = item.productId;
      error.productName = product?.name || "Product";
      error.availableStock = available;
      throw error;
    }
  }

  return productMap;
};
