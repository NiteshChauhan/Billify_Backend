const mongoose = require("mongoose");

const returnSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    partyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Party",
      required: true,
    },
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
      },
    ],
    totalAmount: { type: Number, required: true },
    remarks: String,
  },
  { timestamps: true },
);

module.exports = mongoose.model("Return", returnSchema);

