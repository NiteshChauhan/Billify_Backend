const mongoose = require("mongoose");

const partySchema = new mongoose.Schema(
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

    name: { type: String, required: true },
    phone: String,
    email: String,
    address: String,
    gstNumber: String,

    // 👇 IMPORTANT FIELD
    roles: [
      {
        type: String,
        enum: ["supplier", "vendor", "customer"],
      },
    ],

    openingBalance: { type: Number, default: 0 },
    remainingOpeningBalance: { type: Number, default: 0 },
    openingType: {
      type: String,
      enum: ["receivable", "payable"],
      default: "receivable",
    },
    balance: { type: Number, default: 0 },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Party", partySchema);
