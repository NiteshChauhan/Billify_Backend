const Branch = require("../models/Branch");
const User = require("../models/User");
const SalesInvoice = require("../models/SalesInvoice");
const { enforceLimit, startOfMonth, endOfMonth } = require("../utils/subscription");

exports.enforceBranchLimit = async (req, res, next) => {
  try {
    const count = await Branch.countDocuments({ companyId: req.user.companyId, status: "active" });
    return enforceLimit(req, res, next, "maxBranches", count);
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to validate branch limit", error: err.message });
  }
};

exports.enforceUserLimit = async (req, res, next) => {
  try {
    const count = await User.countDocuments({ companyId: req.user.companyId, isActive: true });
    return enforceLimit(req, res, next, "maxUsers", count);
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to validate user limit", error: err.message });
  }
};

exports.enforceInvoiceLimit = async (req, res, next) => {
  try {
    const count = await SalesInvoice.countDocuments({
      companyId: req.user.companyId,
      createdAt: { $gte: startOfMonth(), $lt: endOfMonth() },
    });
    return enforceLimit(req, res, next, "maxInvoicesPerMonth", count);
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to validate invoice limit", error: err.message });
  }
};
