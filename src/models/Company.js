const mongoose = require("mongoose");

const companySchema = new mongoose.Schema({
  name: String,
  mobile: String,
  email: String,
  gstNumber: String,
  address: String,
  currencySymbol: { type: String, default: "Rs" },
  currencyDecimals: { type: Number, default: 2 },
  pdfLanguage: { type: String, enum: ["en", "hi", "ar"], default: "en" },
  subscriptionExpiry: Date,
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model("Company", companySchema);
