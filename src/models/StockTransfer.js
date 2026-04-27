const mongoose = require("mongoose");

const stockTransferItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    qty: {
      type: Number,
      required: true,
      min: 0,
    },
    rate: {
      type: Number,
      required: true,
      min: 0,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
  },
  { _id: true },
);

const stockTransferSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    transferNo: {
      type: String,
      required: true,
      trim: true,
    },
    fromBranchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    toBranchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    transferDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ["draft", "completed", "cancelled"],
      default: "completed",
      index: true,
    },
    remarks: {
      type: String,
      trim: true,
      default: "",
    },
    items: [stockTransferItemSchema],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    completedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

stockTransferSchema.index({ companyId: 1, transferNo: 1 }, { unique: true });

module.exports = mongoose.model("StockTransfer", stockTransferSchema);
