const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
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

    invoiceType: {
      type: String,
      enum: ["PURCHASE", "SALE"],
      required: true,
    },

    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
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

module.exports = mongoose.model("Payment", paymentSchema);
