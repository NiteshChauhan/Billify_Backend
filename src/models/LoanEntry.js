const mongoose = require("mongoose");
const softDeletePlugin = require("./plugins/softDeletePlugin");

const loanEntrySchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      default: null,
      index: true,
    },
    type: {
      type: String,
      enum: ["loan_in", "loan_out"],
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    remainingAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    date: {
      type: Date,
      required: true,
      index: true,
    },
    note: {
      type: String,
      trim: true,
      default: "",
    },
    paymentType: {
      type: String,
      enum: ["cash", "bank"],
      required: true,
    },
    bankAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BankAccount",
      default: null,
    },
  },
  { timestamps: true },
);

loanEntrySchema.plugin(softDeletePlugin);

module.exports = mongoose.model("LoanEntry", loanEntrySchema);
