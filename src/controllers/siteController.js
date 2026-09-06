const Site = require("../models/Site");
const Party = require("../models/Party");
const PartySite = require("../models/PartySite");
const { escapeRegex, exactNormalizedNameRegex, normalizeName } = require("../utils/normalizeName");

const ownerId = (req) => req.user.companyId;
const actorId = (req) => req.user.userId;

exports.listSites = async (req, res) => {
  try {
    const query = { adminId: ownerId(req), isDeleted: false };
    if (req.query.status) query.status = String(req.query.status).toLowerCase() === "inactive" ? "inactive" : "active";
    const search = String(req.query.search || req.query.q || "").trim();
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
    if (search) {
      const searchRegex = new RegExp(escapeRegex(search), "i");
      const normalizedRegex = new RegExp(escapeRegex(normalizeName(search)), "i");
      query.$or = [{ normalizedName: normalizedRegex }, { name: searchRegex }, { address: searchRegex }];
    }
    if (!req.query.includeOthers && req.query.partyId) query.partyId = req.query.partyId;
    const sites = await Site.find(query)
      .populate("partyId", "name")
      .sort({ name: 1 })
      .limit(limit)
      .lean();

    if (!req.query.partyId) {
      return res.json(sites);
    }

    const mappedSiteIds = await PartySite.distinct("siteId", {
      adminId: ownerId(req),
      partyId: req.query.partyId,
      status: "active",
      isDeleted: false,
    });
    const assignedSet = new Set(mappedSiteIds.map(String));
    const rankedSites = sites
      .map((site) => ({
        ...site,
        isAssigned: String(site.partyId?._id || site.partyId) === String(req.query.partyId) || assignedSet.has(String(site._id)),
      }))
      .sort((a, b) => Number(b.isAssigned) - Number(a.isAssigned) || String(a.name || "").localeCompare(String(b.name || "")));

    res.json(rankedSites);
  } catch (err) {
    res.status(500).json({ message: "Failed to load sites" });
  }
};

exports.createSite = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const partyId = req.body.partyId;
    if (!name || !partyId) return res.status(400).json({ message: "partyId and name are required" });
    const normalizedName = normalizeName(name);

    const party = await Party.findOne({ _id: partyId, companyId: ownerId(req), isActive: true });
    if (!party) return res.status(400).json({ message: "Invalid party" });

    const exactNameRegex = exactNormalizedNameRegex(name);
    const existing = await Site.findOne({
      adminId: ownerId(req),
      $or: [{ normalizedName }, { name: exactNameRegex }],
      isDeleted: false,
    });
    if (existing) {
      await PartySite.findOneAndUpdate(
        { adminId: ownerId(req), partyId, siteId: existing._id, isDeleted: false },
        {
          $setOnInsert: {
            adminId: ownerId(req),
            branchId: req.body.branchId || req.user.branchId || null,
            partyId,
            siteId: existing._id,
            createdBy: actorId(req),
          },
          $set: { status: "active", updatedBy: actorId(req) },
        },
        { upsert: true },
      );
      return res.status(200).json({ ...existing.toObject(), isAssigned: true });
    }

    const site = await Site.create({
      adminId: ownerId(req),
      branchId: req.body.branchId || req.user.branchId || null,
      partyId,
      name,
      normalizedName,
      address: String(req.body.address || "").trim(),
      status: String(req.body.status || "active").toLowerCase() === "inactive" ? "inactive" : "active",
      createdBy: actorId(req),
      updatedBy: actorId(req),
    });
    await PartySite.findOneAndUpdate(
      { adminId: ownerId(req), partyId, siteId: site._id, isDeleted: false },
      {
        $setOnInsert: {
          adminId: ownerId(req),
          branchId: req.body.branchId || req.user.branchId || null,
          partyId,
          siteId: site._id,
          createdBy: actorId(req),
        },
        $set: { status: "active", updatedBy: actorId(req) },
      },
      { upsert: true },
    );
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
    const normalizedName = normalizeName(name);
    const exactNameRegex = exactNormalizedNameRegex(name);
    const duplicate = await Site.findOne({
      _id: { $ne: req.params.id },
      adminId: ownerId(req),
      $or: [{ normalizedName }, { name: exactNameRegex }],
      isDeleted: false,
    }).select("_id");
    if (duplicate) return res.status(409).json({ message: "Site already exists" });
    const site = await Site.findOneAndUpdate(
      { _id: req.params.id, adminId: ownerId(req), isDeleted: false },
      {
        name,
        normalizedName,
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

