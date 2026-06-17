const mongoose = require("mongoose");

const subscriptionPlanSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, required: true },
    code: { type: String, trim: true, uppercase: true, unique: true, required: true },
    description: { type: String, default: "" },
    price: { type: Number, required: true, default: 0 },
    currency: { type: String, trim: true, default: "INR" },
    durationType: {
      type: String,
      enum: ["days", "months", "years"],
      default: "months",
    },
    durationValue: { type: Number, required: true },
    maxBranches: { type: Number, default: 1 },
    maxUsers: { type: Number, default: 5 },
    maxInvoicesPerMonth: { type: Number, default: 100 },
    features: { type: [String], default: [] },
    isTrial: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SuperAdmin",
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SuperAdmin",
    },
    isDeleted: { type: Boolean, default: false },
    deletedAt: Date,
  },
  { timestamps: true },
);

subscriptionPlanSchema.index({ isActive: 1 });
subscriptionPlanSchema.index({ sortOrder: 1 });

module.exports = mongoose.model("SubscriptionPlan", subscriptionPlanSchema);
