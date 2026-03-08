const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Company",
    required: true
  },
  name: String,
  sku: String,
  openingStock: { type: Number, default: 0 },
  openingRate: { type: Number, default: 0 },
  attributes: Object,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Product", productSchema);
