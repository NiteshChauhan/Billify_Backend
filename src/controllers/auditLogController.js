const AuditLog = require("../models/AuditLog");
const { getDateRangeFromQuery } = require("../utils/dateRange");

exports.getAuditLogs = async (req, res) => {
  try {
    const query = { companyId: req.user.companyId };
    if (req.query.module) query.module = req.query.module;
    if (req.query.actionType) query.actionType = req.query.actionType;

    const range = getDateRangeFromQuery(req.query);
    if (range) {
      query.createdAt = { $gte: range.fromDate, $lte: range.toDate };
    }

    const logs = await AuditLog.find(query)
      .populate("userId", "name email")
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(req.query.limit || 200), 500));

    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: err.message || "Failed to load audit logs" });
  }
};
