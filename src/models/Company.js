const mongoose = require("mongoose");

const companySchema = new mongoose.Schema({
  name: String,
  companyCode: String,
  nameAr: String,
  mobile: String,
  whatsapp: String,
  email: String,
  gstNumber: String,
  gstEnabled: { type: Boolean, default: true },
  address: String,
  addressAr: String,
  currencySymbol: { type: String, default: "Rs" },
  currencyDecimals: { type: Number, default: 2 },
  pdfLanguage: { type: String, enum: ["en", "hi", "ar"], default: "en" },
  stockSettlementEnabled: { type: Boolean, default: false },
  subscriptionExpiry: Date,
  subscriptionStatus: {
    type: String,
    enum: ["active", "expired", "cancelled", "trial"],
    default: "trial",
  },
  subscriptionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "AdminSubscription",
  },
  accountStatus: {
    type: String,
    enum: ["active", "inactive"],
    default: "active",
  },
  contactNumber: String,
  createdBySuperAdmin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "SuperAdmin",
  },
  isActive: { type: Boolean, default: true },
  status: { type: String, enum: ["active", "inactive"], default: "active" },
}, { timestamps: true });

module.exports = mongoose.model("Company", companySchema);
