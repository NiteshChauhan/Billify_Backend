const mongoose = require("mongoose");

const partySiteApplicatorSchema = new mongoose.Schema(
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
    siteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Site",
      required: true,
      index: true,
    },
    applicatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Applicator",
      required: true,
      index: true,
    },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
      index: true,
    },
    notes: { type: String, default: "" },
    isDeleted: { type: Boolean, default: false, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

partySiteApplicatorSchema.index(
  { adminId: 1, partyId: 1, siteId: 1, applicatorId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);

module.exports = mongoose.model("PartySiteApplicator", partySiteApplicatorSchema);
