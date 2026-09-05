const mongoose = require("mongoose");
const softDeletePlugin = require("./plugins/softDeletePlugin");

const returnSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      default: null,
      index: true,
    },
    partyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Party",
      default: null,
    },
    siteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Site",
      default: null,
      index: true,
    },
    applicatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Applicator",
      default: null,
      index: true,
    },
    applicatorName: { type: String, default: "" },
    isGST: { type: Boolean, default: false, index: true },
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
        unitId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Unit",
          default: null,
        },
        unitName: { type: String, default: "" },
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

returnSchema.plugin(softDeletePlugin);

returnSchema.index({ companyId: 1, branchId: 1, returnType: 1, returnDate: -1, isDeleted: 1 });
returnSchema.index({ companyId: 1, billType: 1, billId: 1, isDeleted: 1 });
returnSchema.index({ companyId: 1, returnType: 1, returnNo: 1, isDeleted: 1 });

module.exports = mongoose.model("Return", returnSchema);
