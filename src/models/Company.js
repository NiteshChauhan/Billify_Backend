const mongoose = require("mongoose");

const companySchema = new mongoose.Schema({
  name: String,
  companyCode: String,
  nameAr: String,
  mobile: String,
  whatsapp: String,
  email: String,
  gstNumber: String,
  address: String,
  addressAr: String,
  currencySymbol: { type: String, default: "Rs" },
  currencyDecimals: { type: Number, default: 2 },
  pdfLanguage: { type: String, enum: ["en", "hi", "ar"], default: "en" },
  stockSettlementEnabled: { type: Boolean, default: false },
  subscriptionExpiry: Date,
  isActive: { type: Boolean, default: true },
  status: { type: String, enum: ["active", "inactive"], default: "active" },
}, { timestamps: true });

module.exports = mongoose.model("Company", companySchema);
