const mongoose = require("mongoose");

const siteSchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      default: null,
      index: true,
    },
    partyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Party",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    address: { type: String, default: "" },
    status: { type: String, enum: ["active", "inactive"], default: "active", index: true },
    isDeleted: { type: Boolean, default: false, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

siteSchema.index(
  { adminId: 1, partyId: 1, name: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);

module.exports = mongoose.model("Site", siteSchema);
