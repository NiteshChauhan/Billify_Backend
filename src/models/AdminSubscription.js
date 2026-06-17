const mongoose = require("mongoose");

const renewalHistorySchema = new mongoose.Schema(
  {
    renewedAt: { type: Date, default: Date.now },
    previousEndDate: Date,
    newEndDate: Date,
    planId: { type: mongoose.Schema.Types.ObjectId, ref: "SubscriptionPlan" },
    billingMode: String,
    note: String,
    updatedBySuperAdmin: { type: mongoose.Schema.Types.ObjectId, ref: "SuperAdmin" },
  },
  { _id: false },
);

const adminSubscriptionSchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: "SubscriptionPlan" },
    planName: { type: String, trim: true, default: "" },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: {
      type: String,
      enum: ["active", "expired", "cancelled", "trial"],
      default: "active",
      index: true,
    },
    billingMode: {
      type: String,
      enum: ["manual", "dynamic"],
      default: "manual",
    },
    maxBranches: { type: Number, default: 1 },
    maxUsers: { type: Number, default: 3 },
    maxInvoicesPerMonth: { type: Number, default: 100 },
    renewalHistory: { type: [renewalHistorySchema], default: [] },
    createdBySuperAdmin: { type: mongoose.Schema.Types.ObjectId, ref: "SuperAdmin" },
    updatedBySuperAdmin: { type: mongoose.Schema.Types.ObjectId, ref: "SuperAdmin" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("AdminSubscription", adminSubscriptionSchema);
