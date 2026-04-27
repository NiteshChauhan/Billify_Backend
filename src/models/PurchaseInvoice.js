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

    items: [
      {
        productId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
        },
        quantity: Number,
        rate: Number,
        amount: Number,
      },
    ],

    subtotal: Number,
    tax: Number,
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

module.exports = mongoose.model("PurchaseInvoice", purchaseInvoiceSchema);
