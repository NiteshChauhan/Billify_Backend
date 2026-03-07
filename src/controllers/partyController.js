const Party = require("../models/Party");
const normalizeRoles = (roles = []) => {
  const list = Array.isArray(roles) ? roles : [roles];
  return [...new Set(
    list
      .map((role) => String(role || "").toLowerCase())
      .map((role) => (role === "vendor" ? "customer" : role))
      .filter((role) => ["supplier", "customer"].includes(role)),
  )];
};

/* ================= CREATE PARTY ================= */
exports.createParty = async (req, res) => {
  try {
    const { name, openingBalance } = req.body;
    const roles = normalizeRoles(req.body.roles || req.body.role || req.body.type);

    if (!roles || roles.length === 0) {
      return res.status(400).json({ message: "Roles are required" });
    }

    let party = await Party.findOne({
      companyId: req.user.companyId,
      name: name.trim(),
    });

    // If party exists → just merge roles
    if (party) {
      roles.forEach((role) => {
        if (!party.roles.includes(role)) {
          party.roles.push(role);
        }
      });

      await party.save();
      return res.json(party);
    }

    // Create new party
    party = await Party.create({
      companyId: req.user.companyId,
      name: name.trim(),
      ...req.body,
      roles,
      openingBalance: openingBalance || 0,
      isActive: true,
    });

    res.status(201).json(party);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ================= GET ALL PARTIES ================= */
exports.getAllParties = async (req, res) => {
  try {
    const parties = await Party.find({
      companyId: req.user.companyId,
      isActive: true,
    });

    res.json(parties);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ================= GET PARTY BY ID ================= */
exports.getPartyById = async (req, res) => {
  try {
    const party = await Party.findOne({
      _id: req.params.id,
      companyId: req.user.companyId,
      isActive: true,
    });

    if (!party) {
      return res.status(404).json({ message: "Party not found" });
    }

    res.json(party);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ================= GET SUPPLIERS ================= */
exports.getSuppliers = async (req, res) => {
  try {
    const suppliers = await Party.find({
      companyId: req.user.companyId,
      isActive: true,
      roles: "supplier",
    });

    res.json(suppliers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ================= GET VENDORS ================= */
exports.getVendors = async (req, res) => {
  try {
    const vendors = await Party.find({
      companyId: req.user.companyId,
      isActive: true,
      roles: "customer",
    });

    res.json(vendors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ================= GET CUSTOMERS ================= */
exports.getCustomers = async (req, res) => {
  try {
    const customers = await Party.find({
      companyId: req.user.companyId,
      isActive: true,
      roles: "customer",
    });

    res.json(customers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ================= UPDATE PARTY ================= */
exports.updateParty = async (req, res) => {
  try {
    const payload = { ...req.body };
    if (payload.roles || payload.role || payload.type) {
      payload.roles = normalizeRoles(payload.roles || payload.role || payload.type);
    }

    const party = await Party.findOneAndUpdate(
      {
        _id: req.params.id,
        companyId: req.user.companyId,
      },
      payload,
      { new: true },
    );

    res.json(party);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ================= DELETE PARTY (SOFT DELETE) ================= */
exports.deleteParty = async (req, res) => {
  try {
    await Party.findOneAndUpdate(
      {
        _id: req.params.id,
        companyId: req.user.companyId,
      },
      { isActive: false },
    );

    res.json({ message: "Party deactivated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
