const PartySiteApplicator = require("../models/PartySiteApplicator");
const Party = require("../models/Party");
const Site = require("../models/Site");
const Applicator = require("../models/Applicator");

const ownerId = (req) => req.user.companyId;
const actorId = (req) => req.user.userId;

const normalizePayload = (body = {}) => ({
  partyId: body.partyId,
  siteId: body.siteId,
  applicatorId: body.applicatorId,
  startDate: body.startDate ? new Date(body.startDate) : null,
  endDate: body.endDate ? new Date(body.endDate) : null,
  status: String(body.status || "active").toLowerCase() === "inactive" ? "inactive" : "active",
  notes: String(body.notes || "").trim(),
});

const validateRefs = async (req, payload) => {
  const [party, site, applicator] = await Promise.all([
    Party.findOne({ _id: payload.partyId, companyId: ownerId(req), isActive: true }).select("_id"),
    Site.findOne({ _id: payload.siteId, adminId: ownerId(req), partyId: payload.partyId, isDeleted: false }).select("_id"),
    Applicator.findOne({ _id: payload.applicatorId, adminId: ownerId(req), status: "active", isDeleted: false }).select("_id"),
  ]);
  if (!party) return "Invalid party";
  if (!site) return "Invalid site";
  if (!applicator) return "Invalid applicator";
  return "";
};

exports.listAssignments = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
    const query = { adminId: ownerId(req), isDeleted: false };
    ["partyId", "siteId", "applicatorId", "branchId"].forEach((key) => {
      if (req.query[key]) query[key] = req.query[key];
    });
    if (req.query.status) query.status = String(req.query.status).toLowerCase() === "inactive" ? "inactive" : "active";

    const [data, total] = await Promise.all([
      PartySiteApplicator.find(query)
        .populate("partyId", "name")
        .populate("siteId", "name")
        .populate("applicatorId", "name mobile")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      PartySiteApplicator.countDocuments(query),
    ]);
    res.json({ data, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) });
  } catch (err) {
    res.status(500).json({ message: "Failed to load applicator assignments" });
  }
};

exports.listBySite = async (req, res) => {
  try {
    const { partyId, siteId } = req.query;
    if (!partyId || !siteId) return res.json([]);
    const rows = await PartySiteApplicator.find({
      adminId: ownerId(req),
      partyId,
      siteId,
      status: "active",
      isDeleted: false,
    }).populate("applicatorId", "name mobile status isDeleted");

    res.json(
      rows
        .filter((row) => row.applicatorId && row.applicatorId.status === "active" && !row.applicatorId.isDeleted)
        .map((row) => ({
          _id: row._id,
          applicatorId: row.applicatorId._id,
          applicatorName: row.applicatorId.name,
          mobile: row.applicatorId.mobile || "",
        })),
    );
  } catch (err) {
    res.status(500).json({ message: "Failed to load assigned applicators" });
  }
};

exports.createAssignment = async (req, res) => {
  try {
    const payload = normalizePayload(req.body);
    const refError = await validateRefs(req, payload);
    if (refError) return res.status(400).json({ message: refError });

    const existing = await PartySiteApplicator.findOne({
      adminId: ownerId(req),
      partyId: payload.partyId,
      siteId: payload.siteId,
      applicatorId: payload.applicatorId,
      isDeleted: false,
    });
    if (existing) return res.status(409).json({ message: "Applicator is already assigned to this site" });

    const assignment = await PartySiteApplicator.create({
      adminId: ownerId(req),
      branchId: req.body.branchId || req.user.branchId || null,
      ...payload,
      createdBy: actorId(req),
      updatedBy: actorId(req),
    });
    res.status(201).json(assignment);
  } catch (err) {
    res.status(500).json({ message: "Failed to create assignment" });
  }
};

exports.getAssignment = async (req, res) => {
  try {
    const assignment = await PartySiteApplicator.findOne({
      _id: req.params.id,
      adminId: ownerId(req),
      isDeleted: false,
    })
      .populate("partyId", "name")
      .populate("siteId", "name")
      .populate("applicatorId", "name mobile");
    if (!assignment) return res.status(404).json({ message: "Assignment not found" });
    res.json(assignment);
  } catch (err) {
    res.status(500).json({ message: "Failed to load assignment" });
  }
};

exports.updateAssignment = async (req, res) => {
  try {
    const payload = normalizePayload(req.body);
    const refError = await validateRefs(req, payload);
    if (refError) return res.status(400).json({ message: refError });

    const duplicate = await PartySiteApplicator.findOne({
      _id: { $ne: req.params.id },
      adminId: ownerId(req),
      partyId: payload.partyId,
      siteId: payload.siteId,
      applicatorId: payload.applicatorId,
      isDeleted: false,
    });
    if (duplicate) return res.status(409).json({ message: "Applicator is already assigned to this site" });

    const assignment = await PartySiteApplicator.findOneAndUpdate(
      { _id: req.params.id, adminId: ownerId(req), isDeleted: false },
      { ...payload, updatedBy: actorId(req) },
      { new: true },
    );
    if (!assignment) return res.status(404).json({ message: "Assignment not found" });
    res.json(assignment);
  } catch (err) {
    res.status(500).json({ message: "Failed to update assignment" });
  }
};

exports.updateAssignmentStatus = async (req, res) => {
  try {
    const status = String(req.body.status || "active").toLowerCase() === "inactive" ? "inactive" : "active";
    const assignment = await PartySiteApplicator.findOneAndUpdate(
      { _id: req.params.id, adminId: ownerId(req), isDeleted: false },
      { status, updatedBy: actorId(req) },
      { new: true },
    );
    if (!assignment) return res.status(404).json({ message: "Assignment not found" });
    res.json(assignment);
  } catch (err) {
    res.status(500).json({ message: "Failed to update assignment status" });
  }
};

exports.deleteAssignment = async (req, res) => {
  try {
    const assignment = await PartySiteApplicator.findOneAndUpdate(
      { _id: req.params.id, adminId: ownerId(req), isDeleted: false },
      { isDeleted: true, status: "inactive", updatedBy: actorId(req) },
      { new: true },
    );
    if (!assignment) return res.status(404).json({ message: "Assignment not found" });
    res.json({ message: "Assignment deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete assignment" });
  }
};
