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
      default: null,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    normalizedName: { type: String, default: "", trim: true, index: true },
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
siteSchema.index({ adminId: 1, normalizedName: 1, isDeleted: 1 });
siteSchema.index({ adminId: 1, status: 1, normalizedName: 1, isDeleted: 1 });

siteSchema.pre("save", function setNormalizedName(next) {
  this.normalizedName = String(this.name || "").trim().toLowerCase().replace(/\s+/g, " ");
  next();
});

module.exports = mongoose.model("Site", siteSchema);
