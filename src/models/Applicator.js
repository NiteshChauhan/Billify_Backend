const mongoose = require("mongoose");

const applicatorSchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      default: null,
      index: true,
    },
    name: { type: String, required: true, trim: true, index: true },
    normalizedName: { type: String, default: "", trim: true, index: true },
    mobile: { type: String, trim: true, default: "", index: true },
    email: { type: String, trim: true, lowercase: true, default: "" },
    address: { type: String, default: "" },
    city: { type: String, default: "" },
    state: { type: String, default: "" },
    pincode: { type: String, default: "" },
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

applicatorSchema.index({ adminId: 1, normalizedName: 1, isDeleted: 1 });
applicatorSchema.index({ adminId: 1, status: 1, normalizedName: 1, isDeleted: 1 });

applicatorSchema.pre("save", function setNormalizedName(next) {
  this.normalizedName = String(this.name || "").trim().toLowerCase().replace(/\s+/g, " ");
  next();
});

module.exports = mongoose.model("Applicator", applicatorSchema);
