const mongoose = require("mongoose");

const superAdminAuditLogSchema = new mongoose.Schema(
  {
    superAdminId: { type: mongoose.Schema.Types.ObjectId, ref: "SuperAdmin" },
    action: { type: String, trim: true, required: true },
    module: { type: String, trim: true, required: true },
    entityType: { type: String, trim: true, default: "" },
    entityId: { type: mongoose.Schema.Types.ObjectId },
    details: { type: Object, default: {} },
    ipAddress: String,
  },
  { timestamps: true },
);

module.exports = mongoose.model("SuperAdminAuditLog", superAdminAuditLogSchema);
