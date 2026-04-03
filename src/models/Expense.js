const mongoose = require("mongoose");

const expenseSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    date: {
      type: Date,
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
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
    note: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Expense", expenseSchema);
