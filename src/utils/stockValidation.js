const Product = require("../models/Product");
const { getAvailableStock } = require("./stockUtils");

exports.validateStockForSale = async (companyId, items) => {
  for (const item of items) {
    const available = await getAvailableStock(companyId, item.productId);
    if (available < item.quantity) {
      const product = await Product.findById(item.productId).select("name");
      const error = new Error("Insufficient stock");
      error.code = "INSUFFICIENT_STOCK";
      error.productId = item.productId;
      error.productName = product?.name || "Product";
      error.availableStock = available;
      throw error;
    }
  }
};
