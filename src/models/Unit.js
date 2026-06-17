const mongoose = require("mongoose");

const unitSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      default: null,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    shortName: { type: String, trim: true, default: "" },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

unitSchema.index(
  { adminId: 1, name: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);

module.exports = mongoose.model("Unit", unitSchema);
