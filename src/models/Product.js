const mongoose = require("mongoose");
const softDeletePlugin = require("./plugins/softDeletePlugin");
const { normalizeName, normalizeSku } = require("../utils/normalizeName");

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
  normalizedSku: { type: String, default: "", trim: true, index: true },
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
productSchema.index({ companyId: 1, branchId: 1, normalizedSku: 1 });

productSchema.pre("save", function setNormalizedFields() {
  if (this.isModified("name") || !this.normalizedName) {
    this.normalizedName = normalizeName(this.name);
  }
  if (this.isModified("sku") || !this.normalizedSku) {
    this.normalizedSku = normalizeSku(this.sku);
  }
});

const setNormalizedFieldsOnUpdate = function setNormalizedFieldsOnUpdate() {
  const update = this.getUpdate() || {};
  const name = update.name ?? update.$set?.name;
  const sku = update.sku ?? update.$set?.sku;
  if (name === undefined && sku === undefined) return;

  update.$set = { ...(update.$set || {}) };
  if (name !== undefined) update.$set.normalizedName = normalizeName(name);
  if (sku !== undefined) update.$set.normalizedSku = normalizeSku(sku);
  delete update.normalizedName;
  delete update.normalizedSku;
  this.setUpdate(update);
};

productSchema.pre("findOneAndUpdate", setNormalizedFieldsOnUpdate);
productSchema.pre("updateOne", setNormalizedFieldsOnUpdate);
productSchema.pre("updateMany", setNormalizedFieldsOnUpdate);

module.exports = mongoose.model("Product", productSchema);
