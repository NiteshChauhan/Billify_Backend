const Unit = require("../models/Unit");

const ownerId = (req) => req.user.companyId;
const actorId = (req) => req.user.userId;

const normalizePayload = (body = {}) => ({
  name: String(body.name || "").trim(),
  shortName: String(body.shortName || "").trim(),
  isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
});

exports.listUnits = async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "active").toLowerCase();
    const query = { adminId: ownerId(req), isDeleted: false };
    if (status === "active") query.isActive = true;
    if (status === "inactive") query.isActive = false;
    if (search) query.name = new RegExp(search, "i");

    const units = await Unit.find(query).sort({ name: 1 });
    res.json(units);
  } catch (err) {
    res.status(500).json({ message: "Failed to load units" });
  }
};

exports.createUnit = async (req, res) => {
  try {
    const payload = normalizePayload(req.body);
    if (!payload.name) return res.status(400).json({ message: "Unit name is required" });

    const existing = await Unit.findOne({ adminId: ownerId(req), name: payload.name, isDeleted: false });
    if (existing) return res.status(409).json({ message: "Unit already exists" });

    const unit = await Unit.create({
      adminId: ownerId(req),
      branchId: req.user.branchId || null,
      ...payload,
      createdBy: actorId(req),
      updatedBy: actorId(req),
    });
    res.status(201).json(unit);
  } catch (err) {
    res.status(500).json({ message: "Failed to create unit" });
  }
};

exports.getUnit = async (req, res) => {
  try {
    const unit = await Unit.findOne({ _id: req.params.id, adminId: ownerId(req), isDeleted: false });
    if (!unit) return res.status(404).json({ message: "Unit not found" });
    res.json(unit);
  } catch (err) {
    res.status(500).json({ message: "Failed to load unit" });
  }
};

exports.updateUnit = async (req, res) => {
  try {
    const payload = normalizePayload(req.body);
    if (!payload.name) return res.status(400).json({ message: "Unit name is required" });

    const duplicate = await Unit.findOne({
      _id: { $ne: req.params.id },
      adminId: ownerId(req),
      name: payload.name,
      isDeleted: false,
    });
    if (duplicate) return res.status(409).json({ message: "Unit already exists" });

    const unit = await Unit.findOneAndUpdate(
      { _id: req.params.id, adminId: ownerId(req), isDeleted: false },
      { ...payload, updatedBy: actorId(req) },
      { new: true },
    );
    if (!unit) return res.status(404).json({ message: "Unit not found" });
    res.json(unit);
  } catch (err) {
    res.status(500).json({ message: "Failed to update unit" });
  }
};

exports.updateUnitStatus = async (req, res) => {
  try {
    const unit = await Unit.findOneAndUpdate(
      { _id: req.params.id, adminId: ownerId(req), isDeleted: false },
      { isActive: Boolean(req.body.isActive), updatedBy: actorId(req) },
      { new: true },
    );
    if (!unit) return res.status(404).json({ message: "Unit not found" });
    res.json(unit);
  } catch (err) {
    res.status(500).json({ message: "Failed to update unit status" });
  }
};

exports.deleteUnit = async (req, res) => {
  try {
    const unit = await Unit.findOneAndUpdate(
      { _id: req.params.id, adminId: ownerId(req), isDeleted: false },
      { isDeleted: true, isActive: false, updatedBy: actorId(req) },
      { new: true },
    );
    if (!unit) return res.status(404).json({ message: "Unit not found" });
    res.json({ message: "Unit deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete unit" });
  }
};
