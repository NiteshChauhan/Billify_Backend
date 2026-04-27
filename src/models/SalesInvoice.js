const mongoose = require("mongoose");
const softDeletePlugin = require("./plugins/softDeletePlugin");

const salesInvoiceSchema = new mongoose.Schema(
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

    // 🔥 Changed from vendorId → partyId
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
    customerBranch: String,
    customerAttn: String,
    customerTel: String,
    salesman: String,
    lpoNo: String,

    items: [
      {
        productId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
        },
        productName: String,
        productNameAr: String,
        productNameHi: String,
        packing: String,
        quantity: Number,
        rate: Number,
        amount: Number,
        actualCost: { type: Number, default: 0 },
        profitAmount: { type: Number, default: 0 },
        costBreakdown: [
          {
            batchId: {
              type: mongoose.Schema.Types.ObjectId,
              ref: "StockBatch",
            },
            qty: Number,
            rate: Number,
            cost: Number,
            sourceHint: String,
          },
        ],
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

salesInvoiceSchema.plugin(softDeletePlugin);

module.exports = mongoose.model("SalesInvoice", salesInvoiceSchema);
