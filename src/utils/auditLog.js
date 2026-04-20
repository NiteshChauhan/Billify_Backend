const AuditLog = require("../models/AuditLog");

const logAudit = async ({
  companyId,
  userId = null,
  actionType,
  module,
  entityId = null,
  description = "",
  details = null,
}) => {
  if (!companyId || !actionType || !module) return;

  try {
    await AuditLog.create({
      companyId,
      userId,
      actionType,
      module,
      entityId,
      description,
      details,
    });
  } catch (err) {
    console.error("Audit log failed:", err.message);
  }
};

module.exports = { logAudit };
