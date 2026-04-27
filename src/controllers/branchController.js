const Branch = require("../models/Branch");
const { ensureDefaultBranch } = require("../utils/branchContext");

const normalizePayload = (body = {}) => ({
  branchName: String(body.branchName || "").trim(),
  branchCode: String(body.branchCode || "").trim(),
  type: ["shop", "warehouse", "branch"].includes(String(body.type || "").toLowerCase())
    ? String(body.type).toLowerCase()
    : "shop",
  address: String(body.address || "").trim(),
  phone: String(body.phone || "").trim(),
  status: String(body.status || "active").toLowerCase() === "inactive" ? "inactive" : "active",
  isDefault: Boolean(body.isDefault),
});

const clearDefaultFlag = async (companyId, exceptId = null) => {
  const query = { companyId, isDefault: true };
  if (exceptId) {
    query._id = { $ne: exceptId };
  }
  await Branch.updateMany(query, { $set: { isDefault: false } });
};

exports.listBranches = async (req, res) => {
  try {
    await ensureDefaultBranch(req.user.companyId);
    const branches = await Branch.find({ companyId: req.user.companyId }).sort({
      isDefault: -1,
      branchName: 1,
    });
    res.json(branches);
  } catch (err) {
    res.status(500).json({ message: "Failed to load branches", error: err.message });
  }
};

exports.createBranch = async (req, res) => {
  try {
    const payload = normalizePayload(req.body);
    if (!payload.branchName) {
      return res.status(400).json({ message: "branchName is required" });
    }

    if (payload.isDefault) {
      await clearDefaultFlag(req.user.companyId);
    }

    const branch = await Branch.create({
      companyId: req.user.companyId,
      ...payload,
    });

    res.json(branch);
  } catch (err) {
    res.status(500).json({ message: "Failed to create branch", error: err.message });
  }
};

exports.updateBranch = async (req, res) => {
  try {
    const payload = normalizePayload(req.body);
    if (!payload.branchName) {
      return res.status(400).json({ message: "branchName is required" });
    }

    const existing = await Branch.findOne({
      _id: req.params.id,
      companyId: req.user.companyId,
    });
    if (!existing) {
      return res.status(404).json({ message: "Branch not found" });
    }

    if (payload.isDefault) {
      await clearDefaultFlag(req.user.companyId, existing._id);
    }

    Object.assign(existing, payload);
    await existing.save();
    res.json(existing);
  } catch (err) {
    res.status(500).json({ message: "Failed to update branch", error: err.message });
  }
};

