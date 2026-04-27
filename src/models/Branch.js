const mongoose = require("mongoose");

const branchSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    branchName: {
      type: String,
      required: true,
      trim: true,
    },
    branchCode: {
      type: String,
      trim: true,
      default: "",
    },
    type: {
      type: String,
      enum: ["shop", "warehouse", "branch"],
      default: "shop",
    },
    address: {
      type: String,
      trim: true,
      default: "",
    },
    phone: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
      index: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

branchSchema.index({ companyId: 1, branchName: 1 }, { unique: true });
branchSchema.index({ companyId: 1, branchCode: 1 }, { sparse: true });

module.exports = mongoose.model("Branch", branchSchema);
