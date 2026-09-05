const mongoose = require("mongoose");
const softDeletePlugin = require("./plugins/softDeletePlugin");

const purchaseInvoiceSchema = new mongoose.Schema(
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

    // 🔥 Changed from supplierId → partyId
    partyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Party",
      required: false,
    },

    paymentType: {
      type: String,
      enum: ["cash", "bank", "credit"],
      default: "credit",
    },

    bankAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BankAccount",
      default: null,
    },

    invoiceNo: String,
    invoiceDate: { type: Date, default: Date.now },
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

    items: [
      {
        productId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
        },
        productName: String,
        unitId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Unit",
          default: null,
        },
        unitName: { type: String, default: "" },
        quantity: Number,
        rate: Number,
        amount: Number,
      },
    ],

    subtotal: Number,
    tax: Number,
    otherCharges: [
      {
        name: { type: String, trim: true },
        amount: { type: Number, default: 0 },
      },
    ],
    otherChargesTotal: { type: Number, default: 0 },
    totalAmount: Number,

    paidAmount: { type: Number, default: 0 },
    pendingAmount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["PAID", "PARTIAL", "DUE"],
      default: "DUE",
    },
  },
  { timestamps: true },
);

purchaseInvoiceSchema.plugin(softDeletePlugin);

purchaseInvoiceSchema.index({ companyId: 1, invoiceNo: 1, isDeleted: 1 });
purchaseInvoiceSchema.index({ companyId: 1, branchId: 1, invoiceDate: -1, isDeleted: 1 });
purchaseInvoiceSchema.index({ companyId: 1, partyId: 1, invoiceDate: -1, isDeleted: 1 });

module.exports = mongoose.model("PurchaseInvoice", purchaseInvoiceSchema);
