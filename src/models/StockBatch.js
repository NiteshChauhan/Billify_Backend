const mongoose = require("mongoose");

const stockBatchSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    sourceType: {
      type: String,
      enum: ["OPENING", "PURCHASE", "SALE_RETURN", "LEGACY"],
      required: true,
      index: true,
    },
    sourceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    totalQty: {
      type: Number,
      required: true,
      min: 0,
    },
    remainingQty: {
      type: Number,
      required: true,
      min: 0,
    },
    rate: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("StockBatch", stockBatchSchema);
