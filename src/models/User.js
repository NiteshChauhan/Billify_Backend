const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Company",
    required: true
  },
  name: String,
  email: { type: String, unique: true },
  password: String,
  role: {
    type: String,
    enum: ["admin", "staff", "accountant"],
    default: "admin"
  },
  contactNumber: String,
  accountStatus: {
    type: String,
    enum: ["active", "inactive"],
    default: "active",
  },
  subscriptionStatus: {
    type: String,
    enum: ["active", "expired", "cancelled", "trial"],
    default: "trial",
  },
  subscriptionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "AdminSubscription",
  },
  createdBySuperAdmin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "SuperAdmin",
  },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);
