const mongoose = require("mongoose");
const softDeletePlugin = require("./plugins/softDeletePlugin");

const productSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Company",
    required: true
  },
  branchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Branch",
    default: null,
    index: true,
  },
  name: String,
  normalizedName: { type: String, default: "", trim: true, index: true },
  nameAr: String,
  nameHi: String,
  sku: String,
  price: { type: Number, default: 0 },
  openingStock: { type: Number, default: 0 },
  openingRate: { type: Number, default: 0 },
  lowStockAlert: { type: Number, default: 0, min: 0 },
  lastPurchaseRate: { type: Number, default: 0 },
  lastSalePrice: { type: Number, default: 0 },
  unitId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Unit",
    default: null,
  },
  unitName: { type: String, default: "" },
  attributes: Object,
  createdAt: { type: Date, default: Date.now }
});

productSchema.plugin(softDeletePlugin);
productSchema.index({ companyId: 1, branchId: 1, normalizedName: 1 });

productSchema.pre("save", function setNormalizedName(next) {
  this.normalizedName = String(this.name || "").trim().toLowerCase().replace(/\s+/g, " ");
  next();
});

module.exports = mongoose.model("Product", productSchema);
