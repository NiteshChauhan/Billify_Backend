const mongoose = require("mongoose");

const companyBalanceSchema = new mongoose.Schema(
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
    openingBalance: {
      type: Number,
      required: true,
      default: 0,
    },
  },
  { timestamps: true },
);

companyBalanceSchema.index({ companyId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("CompanyBalance", companyBalanceSchema);
