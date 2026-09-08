const Company = require("../models/Company");
const Product = require("../models/Product");
const { getAvailableStock } = require("./stockUtils");

const withSession = (query, session) => (session ? query.session(session) : query);

exports.validateStockForSale = async (companyId, branchId, items, branchIsDefault = false, options = {}) => {
  const company = await withSession(
    Company.findById(companyId).select("stockSettlementEnabled"),
    options.session,
  );
  const stockSettlementEnabled = Boolean(company?.stockSettlementEnabled);

  if (!stockSettlementEnabled) {
    return { stockSettlementEnabled };
  }

  const productIds = [...new Set((items || []).map((item) => String(item.productId || "")).filter(Boolean))];
  const products = await withSession(
    Product.find({
      _id: { $in: productIds },
      companyId,
    }).select("name"),
    options.session,
  );
  const productMap = new Map(products.map((product) => [String(product._id), product]));

  for (const item of items) {
    const available = await getAvailableStock(companyId, branchId, item.productId, new Date(), branchIsDefault, options);
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
