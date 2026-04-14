const mongoose = require("mongoose");

const returnSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    partyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Party",
      default: null,
    },
    returnType: {
      type: String,
      enum: ["SALE_RETURN", "PURCHASE_RETURN"],
      required: true,
    },
    billType: {
      type: String,
      enum: ["SALE", "PURCHASE"],
      required: true,
    },
    billId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    originalSaleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SalesInvoice",
    },
    originalPurchaseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PurchaseInvoice",
    },
    returnNo: {
      type: String,
      trim: true,
    },
    returnDate: {
      type: Date,
      default: Date.now,
    },
    items: [
      {
        productId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        quantity: { type: Number, required: true },
        rate: { type: Number, required: true },
        amount: { type: Number, required: true },
        costAmount: { type: Number, default: 0 },
      },
    ],
    totalAmount: { type: Number, required: true },
    remarks: String,
    hasReplacement: { type: Boolean, default: false },
    replacementBillId: { type: mongoose.Schema.Types.ObjectId },
    replacementBillType: { type: String, enum: ["SALE", "PURCHASE"] },
    netDifference: { type: Number, default: 0 },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Return", returnSchema);
