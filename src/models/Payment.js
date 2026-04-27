const mongoose = require("mongoose");
const softDeletePlugin = require("./plugins/softDeletePlugin");

const paymentSchema = new mongoose.Schema(
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

    // 🔥 Single party reference
    partyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Party",
      required: false,
    },

    amount: {
      type: Number,
      required: true,
    },

    paymentMode: {
      type: String,
      enum: ["CASH", "UPI", "BANK", "CHEQUE"],
      default: "CASH",
    },

    bankAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BankAccount",
      default: null,
    },

    paymentType: {
      type: String,
      enum: ["PAID", "RECEIVED"],
      default: "RECEIVED",
    },

    adjustType: {
      type: String,
      enum: ["opening", "bill"],
      default: "bill",
    },

    invoiceType: {
      type: String,
      enum: ["PURCHASE", "SALE", "OPENING"],
      required: true,
    },

    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      required: false,
    },

    referenceNo: String,
    remarks: String,

    paymentDate: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

paymentSchema.plugin(softDeletePlugin);

module.exports = mongoose.model("Payment", paymentSchema);
