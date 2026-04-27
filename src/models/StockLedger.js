const mongoose = require("mongoose");

const stockLedgerSchema = new mongoose.Schema({
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
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true
  },

  type: {
    type: String,
    enum: [
      "PURCHASE",
      "SALE",
      "OPENING",
      "ADJUSTMENT",
      "PURCHASE_RETURN",
      "SALE_RETURN",
      "TRANSFER_OUT",
      "TRANSFER_IN",
    ],
    required: true
  },

  quantity: { type: Number, required: true },
  rate: { type: Number, required: true },

  referenceType: String,   // PURCHASE_INVOICE, SALES_INVOICE
  referenceId: mongoose.Schema.Types.ObjectId,

  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("StockLedger", stockLedgerSchema);
