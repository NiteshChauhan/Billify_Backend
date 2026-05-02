const Party = require("../models/Party");
const SalesInvoice = require("../models/SalesInvoice");
const PurchaseInvoice = require("../models/PurchaseInvoice");
const Payment = require("../models/Payment");
const ReturnEntry = require("../models/Return");
const { withBranchScope } = require("../utils/branchScope");
const normalizeRoles = (roles = []) => {
  const list = Array.isArray(roles) ? roles : [roles];
  return [...new Set(
    list
      .map((role) => String(role || "").toLowerCase())
      .map((role) => (role === "vendor" ? "customer" : role))
      .filter((role) => ["supplier", "customer"].includes(role)),
  )];
};

const getScopedPartyIds = async (companyId, branchScope) => {
  const [sales, purchases, payments, returns] = await Promise.all([
    SalesInvoice.distinct("partyId", withBranchScope({ companyId }, branchScope)),
    PurchaseInvoice.distinct("partyId", withBranchScope({ companyId }, branchScope)),
    Payment.distinct("partyId", withBranchScope({ companyId }, branchScope)),
    ReturnEntry.distinct("partyId", withBranchScope({ companyId }, branchScope)),
  ]);

  return [
    ...new Set(
      [...sales, ...purchases, ...payments, ...returns]
        .map((id) => String(id || ""))
        .filter(Boolean),
    ),
  ];
};

/* ================= CREATE PARTY ================= */
exports.createParty = async (req, res) => {
  try {
    const { name, openingBalance, openingType } = req.body;
    const branchScope = req.user.branchScope || req.user.branchId || null;
    const branchId = req.user.branchId || null;
    const roles = normalizeRoles(req.body.roles || req.body.role || req.body.type);

    if (!roles || roles.length === 0) {
      return res.status(400).json({ message: "Roles are required" });
    }

    let party = await Party.findOne(
      withBranchScope(
        {
          companyId: req.user.companyId,
          name: name.trim(),
        },
        branchScope,
      ),
    );

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
    const normalizedOpeningBalance = Number(openingBalance || 0);
    const normalizedOpeningType = String(openingType || "receivable").toLowerCase() === "payable" ? "payable" : "receivable";

    party = await Party.create({
      companyId: req.user.companyId,
      branchId,
      name: name.trim(),
      ...req.body,
      roles,
      openingBalance: normalizedOpeningBalance,
      remainingOpeningBalance: normalizedOpeningBalance,
      openingType: normalizedOpeningType,
      balance: normalizedOpeningBalance,
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
    const baseQuery = {
      companyId: req.user.companyId,
      isActive: true,
    };
    if (String(req.query.branchScoped || "") === "1") {
      const query = withBranchScope(baseQuery, req.user.branchScope || req.user.branchId || null);
      const parties = await Party.find(query);
      return res.json(parties);
    }
    const parties = await Party.find(baseQuery);

    res.json(parties);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ================= GET PARTY BY ID ================= */
exports.getPartyById = async (req, res) => {
  try {
    const party = await Party.findOne(
      withBranchScope(
        {
          _id: req.params.id,
          companyId: req.user.companyId,
          isActive: true,
        },
        req.user.branchScope || req.user.branchId || null,
      ),
    );

    if (!party) {
      return res.status(404).json({ message: "Party not found" });
    }

    res.json(party);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getPartyOutstanding = async (req, res) => {
  try {
    const party = await Party.findOne(
      withBranchScope(
        {
          _id: req.params.id,
          companyId: req.user.companyId,
          isActive: true,
        },
        req.user.branchScope || req.user.branchId || null,
      ),
    );

    if (!party) {
      return res.status(404).json({ message: "Party not found" });
    }

    const [sales, purchases, payments, returns] = await Promise.all([
      SalesInvoice.find(withBranchScope({ companyId: req.user.companyId, partyId: party._id }, req.user.branchScope || req.user.branchId || null))
        .select("invoiceNo invoiceDate totalAmount paidAmount pendingAmount")
        .sort({ invoiceDate: 1, createdAt: 1 }),
      PurchaseInvoice.find(withBranchScope({ companyId: req.user.companyId, partyId: party._id }, req.user.branchScope || req.user.branchId || null))
        .select("invoiceNo invoiceDate totalAmount paidAmount pendingAmount")
        .sort({ invoiceDate: 1, createdAt: 1 }),
      Payment.find(withBranchScope({ companyId: req.user.companyId, partyId: party._id }, req.user.branchScope || req.user.branchId || null))
        .select("amount paymentType invoiceType invoiceId adjustType"),
      ReturnEntry.find(withBranchScope({ companyId: req.user.companyId, partyId: party._id }, req.user.branchScope || req.user.branchId || null))
        .select("billId billType returnType totalAmount"),
    ]);

    const paymentTotalsByInvoice = new Map();
    let openingPaid = 0;
    payments.forEach((payment) => {
      const amount = Number(payment.amount || 0);
      if (payment.adjustType === "opening" || payment.invoiceType === "OPENING") {
        openingPaid += amount;
        return;
      }
      if (!payment.invoiceId) return;
      const key = `${payment.invoiceType}:${String(payment.invoiceId)}`;
      paymentTotalsByInvoice.set(key, Number(paymentTotalsByInvoice.get(key) || 0) + amount);
    });

    const returnTotalsByInvoice = new Map();
    returns.forEach((entry) => {
      if (!entry.billId || !entry.billType) return;
      const key = `${entry.billType}:${String(entry.billId)}`;
      returnTotalsByInvoice.set(key, Number(returnTotalsByInvoice.get(key) || 0) + Number(entry.totalAmount || 0));
    });

    const items = [];
    const openingBalance = Number(party.openingBalance || 0);
    const openingDirection =
      String(party.openingType || "receivable").toLowerCase() === "payable" ? -1 : 1;
    const openingDue = Math.max(0, openingBalance - openingPaid);

    console.log("[Outstanding] Party:", String(party._id));
    console.log("[Outstanding] Opening:", openingBalance);
    console.log("[Outstanding] Opening Paid:", openingPaid);

    if (openingDue > 0) {
      items.push({
        id: `opening-${party._id}`,
        type: "opening",
        refId: String(party._id),
        refNo: "Opening Balance",
        date: party.createdAt,
        totalAmount: openingBalance,
        paidAmount: openingPaid,
        pendingAmount: openingDue,
      });
    }

    sales.forEach((invoice) => {
      const invoiceTotal = Number(invoice.totalAmount || 0);
      const paidAmount = Number(
        paymentTotalsByInvoice.get(`SALE:${String(invoice._id)}`) ?? invoice.paidAmount ?? 0,
      );
      const returnAmount = Number(returnTotalsByInvoice.get(`SALE:${String(invoice._id)}`) || 0);
      const pendingAmount = Math.max(0, invoiceTotal - paidAmount - returnAmount);
      if (pendingAmount > 0) {
        items.push({
          id: `sale-${invoice._id}`,
          type: "sale",
          refId: String(invoice._id),
          refNo: invoice.invoiceNo || "-",
          date: invoice.invoiceDate,
          totalAmount: invoiceTotal,
          paidAmount,
          returnAmount,
          pendingAmount,
        });
      }
    });

    purchases.forEach((invoice) => {
      const invoiceTotal = Number(invoice.totalAmount || 0);
      const paidAmount = Number(
        paymentTotalsByInvoice.get(`PURCHASE:${String(invoice._id)}`) ?? invoice.paidAmount ?? 0,
      );
      const returnAmount = Number(returnTotalsByInvoice.get(`PURCHASE:${String(invoice._id)}`) || 0);
      const pendingAmount = Math.max(0, invoiceTotal - paidAmount - returnAmount);
      if (pendingAmount > 0) {
        items.push({
          id: `purchase-${invoice._id}`,
          type: "purchase",
          refId: String(invoice._id),
          refNo: invoice.invoiceNo || "-",
          date: invoice.invoiceDate,
          totalAmount: invoiceTotal,
          paidAmount,
          returnAmount,
          pendingAmount,
        });
      }
    });

    const salesDue = items
      .filter((item) => item.type === "sale")
      .reduce((sum, item) => sum + Number(item.pendingAmount || 0), 0);
    const purchaseDue = items
      .filter((item) => item.type === "purchase")
      .reduce((sum, item) => sum + Number(item.pendingAmount || 0), 0);
    const totalDue = Math.max(0, openingDirection * openingDue + salesDue - purchaseDue);

    console.log("[Outstanding] Sales:", salesDue);
    console.log("[Outstanding] Purchases:", purchaseDue);
    console.log("[Outstanding] Total Due:", totalDue);

    res.json({
      partyId: String(party._id),
      totalDue,
      items,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ================= GET SUPPLIERS ================= */
exports.getSuppliers = async (req, res) => {
  try {
    const suppliers = await Party.find({
      ...withBranchScope(
        {
          companyId: req.user.companyId,
          isActive: true,
          roles: "supplier",
        },
        req.user.branchScope || req.user.branchId || null,
      ),
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
      ...withBranchScope(
        {
          companyId: req.user.companyId,
          isActive: true,
          roles: "customer",
        },
        req.user.branchScope || req.user.branchId || null,
      ),
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
      ...withBranchScope(
        {
          companyId: req.user.companyId,
          isActive: true,
          roles: "customer",
        },
        req.user.branchScope || req.user.branchId || null,
      ),
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

    const existing = await Party.findOne(
      withBranchScope(
        {
          _id: req.params.id,
          companyId: req.user.companyId,
        },
        req.user.branchScope || req.user.branchId || null,
      ),
    );

    if (!existing) {
      return res.status(404).json({ message: "Party not found" });
    }

    const nextOpeningBalance = Number(payload.openingBalance ?? existing.openingBalance ?? 0);
    const previousOpeningBalance = Number(existing.openingBalance || 0);
    payload.openingBalance = nextOpeningBalance;
    payload.remainingOpeningBalance =
      payload.remainingOpeningBalance !== undefined
        ? Number(payload.remainingOpeningBalance || 0)
        : Number(existing.remainingOpeningBalance ?? existing.openingBalance ?? 0) +
          (nextOpeningBalance - previousOpeningBalance);
    payload.openingType =
      String(payload.openingType || existing.openingType || "receivable").toLowerCase() === "payable"
        ? "payable"
        : "receivable";
    payload.balance = Number(existing.balance || 0) + (nextOpeningBalance - previousOpeningBalance);

    const party = await Party.findOneAndUpdate(
      withBranchScope(
        {
          _id: req.params.id,
          companyId: req.user.companyId,
        },
        req.user.branchScope || req.user.branchId || null,
      ),
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
      withBranchScope(
        {
          _id: req.params.id,
          companyId: req.user.companyId,
        },
        req.user.branchScope || req.user.branchId || null,
      ),
      { isActive: false },
    );

    res.json({ message: "Party deactivated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
