const Site = require("../models/Site");
const Party = require("../models/Party");

const ownerId = (req) => req.user.companyId;
const actorId = (req) => req.user.userId;

exports.listSites = async (req, res) => {
  try {
    const query = { adminId: ownerId(req), isDeleted: false };
    if (req.query.partyId) query.partyId = req.query.partyId;
    if (req.query.status) query.status = String(req.query.status).toLowerCase() === "inactive" ? "inactive" : "active";
    const sites = await Site.find(query).populate("partyId", "name").sort({ name: 1 });
    res.json(sites);
  } catch (err) {
    res.status(500).json({ message: "Failed to load sites" });
  }
};

exports.createSite = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const partyId = req.body.partyId;
    if (!name || !partyId) return res.status(400).json({ message: "partyId and name are required" });

    const party = await Party.findOne({ _id: partyId, companyId: ownerId(req), isActive: true });
    if (!party) return res.status(400).json({ message: "Invalid party" });

    const existing = await Site.findOne({ adminId: ownerId(req), partyId, name, isDeleted: false });
    if (existing) return res.status(409).json({ message: "Site already exists for this party" });

    const site = await Site.create({
      adminId: ownerId(req),
      branchId: req.body.branchId || req.user.branchId || null,
      partyId,
      name,
      address: String(req.body.address || "").trim(),
      status: String(req.body.status || "active").toLowerCase() === "inactive" ? "inactive" : "active",
      createdBy: actorId(req),
      updatedBy: actorId(req),
    });
    res.status(201).json(site);
  } catch (err) {
    res.status(500).json({ message: "Failed to create site" });
  }
};

exports.getSite = async (req, res) => {
  try {
    const site = await Site.findOne({ _id: req.params.id, adminId: ownerId(req), isDeleted: false });
    if (!site) return res.status(404).json({ message: "Site not found" });
    res.json(site);
  } catch (err) {
    res.status(500).json({ message: "Failed to load site" });
  }
};

exports.updateSite = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).json({ message: "Site name is required" });
    const site = await Site.findOneAndUpdate(
      { _id: req.params.id, adminId: ownerId(req), isDeleted: false },
      {
        name,
        address: String(req.body.address || "").trim(),
        status: String(req.body.status || "active").toLowerCase() === "inactive" ? "inactive" : "active",
        updatedBy: actorId(req),
      },
      { new: true },
    );
    if (!site) return res.status(404).json({ message: "Site not found" });
    res.json(site);
  } catch (err) {
    res.status(500).json({ message: "Failed to update site" });
  }
};

exports.updateSiteStatus = async (req, res) => {
  try {
    const status = String(req.body.status || "active").toLowerCase() === "inactive" ? "inactive" : "active";
    const site = await Site.findOneAndUpdate(
      { _id: req.params.id, adminId: ownerId(req), isDeleted: false },
      { status, updatedBy: actorId(req) },
      { new: true },
    );
    if (!site) return res.status(404).json({ message: "Site not found" });
    res.json(site);
  } catch (err) {
    res.status(500).json({ message: "Failed to update site status" });
  }
};

exports.deleteSite = async (req, res) => {
  try {
    const site = await Site.findOneAndUpdate(
      { _id: req.params.id, adminId: ownerId(req), isDeleted: false },
      { isDeleted: true, status: "inactive", updatedBy: actorId(req) },
    );
    if (!site) return res.status(404).json({ message: "Site not found" });
    res.json({ message: "Site deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete site" });
  }
};
