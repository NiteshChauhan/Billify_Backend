const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Company",
    required: true
  },
  name: String,
  sku: String,
  price: { type: Number, default: 0 },
  openingStock: { type: Number, default: 0 },
  openingRate: { type: Number, default: 0 },
  lastPurchaseRate: { type: Number, default: 0 },
  lastSalePrice: { type: Number, default: 0 },
  attributes: Object,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Product", productSchema);
