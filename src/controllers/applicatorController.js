const Applicator = require("../models/Applicator");

const ownerId = (req) => req.user.companyId;
const actorId = (req) => req.user.userId;

const normalizePayload = (body = {}) => ({
  name: String(body.name || "").trim(),
  mobile: String(body.mobile || "").trim(),
  email: String(body.email || "").trim().toLowerCase(),
  address: String(body.address || "").trim(),
  city: String(body.city || "").trim(),
  state: String(body.state || "").trim(),
  pincode: String(body.pincode || "").trim(),
  status: String(body.status || "active").toLowerCase() === "inactive" ? "inactive" : "active",
  notes: String(body.notes || "").trim(),
});

const findDuplicate = (req, payload, excludeId = null) => {
  const query = { adminId: ownerId(req), isDeleted: false };
  if (excludeId) query._id = { $ne: excludeId };
  if (payload.mobile) query.mobile = payload.mobile;
  else query.name = payload.name;
  return Applicator.findOne(query).select("_id");
};

exports.listApplicators = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").toLowerCase();
    const query = { adminId: ownerId(req), isDeleted: false };
    if (status === "active" || status === "inactive") query.status = status;
    if (req.query.branchId) query.branchId = req.query.branchId;
    if (search) {
      query.$or = [
        { name: new RegExp(search, "i") },
        { mobile: new RegExp(search, "i") },
        { city: new RegExp(search, "i") },
      ];
    }

    const [data, total] = await Promise.all([
      Applicator.find(query)
        .select("_id name mobile email city state status branchId createdAt")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Applicator.countDocuments(query),
    ]);
    res.json({ data, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) });
  } catch (err) {
    res.status(500).json({ message: "Failed to load applicators" });
  }
};

exports.createApplicator = async (req, res) => {
  try {
    const payload = normalizePayload(req.body);
    if (!payload.name) return res.status(400).json({ message: "Applicator name is required" });
    if (await findDuplicate(req, payload)) {
      return res.status(409).json({ message: "Applicator already exists" });
    }
    const applicator = await Applicator.create({
      adminId: ownerId(req),
      branchId: req.body.branchId || req.user.branchId || null,
      ...payload,
      createdBy: actorId(req),
      updatedBy: actorId(req),
    });
    res.status(201).json(applicator);
  } catch (err) {
    res.status(500).json({ message: "Failed to create applicator" });
  }
};

exports.getApplicator = async (req, res) => {
  try {
    const applicator = await Applicator.findOne({ _id: req.params.id, adminId: ownerId(req), isDeleted: false });
    if (!applicator) return res.status(404).json({ message: "Applicator not found" });
    res.json(applicator);
  } catch (err) {
    res.status(500).json({ message: "Failed to load applicator" });
  }
};

exports.updateApplicator = async (req, res) => {
  try {
    const payload = normalizePayload(req.body);
    if (!payload.name) return res.status(400).json({ message: "Applicator name is required" });
    if (await findDuplicate(req, payload, req.params.id)) {
      return res.status(409).json({ message: "Applicator already exists" });
    }
    const applicator = await Applicator.findOneAndUpdate(
      { _id: req.params.id, adminId: ownerId(req), isDeleted: false },
      { branchId: req.body.branchId || null, ...payload, updatedBy: actorId(req) },
      { new: true },
    );
    if (!applicator) return res.status(404).json({ message: "Applicator not found" });
    res.json(applicator);
  } catch (err) {
    res.status(500).json({ message: "Failed to update applicator" });
  }
};

exports.updateApplicatorStatus = async (req, res) => {
  try {
    const status = String(req.body.status || "active").toLowerCase() === "inactive" ? "inactive" : "active";
    const applicator = await Applicator.findOneAndUpdate(
      { _id: req.params.id, adminId: ownerId(req), isDeleted: false },
      { status, updatedBy: actorId(req) },
      { new: true },
    );
    if (!applicator) return res.status(404).json({ message: "Applicator not found" });
    res.json(applicator);
  } catch (err) {
    res.status(500).json({ message: "Failed to update applicator status" });
  }
};

exports.deleteApplicator = async (req, res) => {
  try {
    const applicator = await Applicator.findOneAndUpdate(
      { _id: req.params.id, adminId: ownerId(req), isDeleted: false },
      { isDeleted: true, status: "inactive", updatedBy: actorId(req) },
      { new: true },
    );
    if (!applicator) return res.status(404).json({ message: "Applicator not found" });
    res.json({ message: "Applicator deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete applicator" });
  }
};
