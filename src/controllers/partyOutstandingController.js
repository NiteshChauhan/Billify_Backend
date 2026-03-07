const Party = require("../models/Party");
const PurchaseInvoice = require("../models/PurchaseInvoice");
const SalesInvoice = require("../models/SalesInvoice");
const { getDateRangeFromQuery } = require("../utils/dateRange");

const normalizeRole = (role = "") => {
  const value = String(role).toLowerCase();
  if (value === "vendor") return "customer";
  return value;
};

const buildRangeFilter = (req) => {
  const range = getDateRangeFromQuery(req.query);
  if (!range) return {};
  return { invoiceDate: { $gte: range.fromDate, $lte: range.toDate } };
};

const buildOutstandingForRole = async ({ companyId, role, rangeFilter }) => {
  const parties = await Party.find({
    companyId,
    isActive: true,
    roles: role,
  });

  const invoices =
    role === "supplier"
      ? await PurchaseInvoice.find({ companyId, ...rangeFilter })
      : await SalesInvoice.find({ companyId, ...rangeFilter });

  const invoiceMap = {};
  invoices.forEach((inv) => {
    const id = inv.partyId?.toString();
    if (!id) return;
    if (!invoiceMap[id]) invoiceMap[id] = { total: 0, paid: 0 };
    invoiceMap[id].total += inv.totalAmount || 0;
    invoiceMap[id].paid += inv.paidAmount || 0;
  });

  return parties.map((party) => {
    const values = invoiceMap[party._id.toString()] || { total: 0, paid: 0 };
    const outstanding = (party.openingBalance || 0) + values.total - values.paid;
    return {
      partyId: party._id,
      partyName: party.name,
      role,
      total: values.total,
      paid: values.paid,
      outstanding,
      totalPurchase: role === "supplier" ? values.total : 0,
      totalPaid: role === "supplier" ? values.paid : 0,
      totalSales: role !== "supplier" ? values.total : 0,
      totalReceived: role !== "supplier" ? values.paid : 0,
    };
  });
};

exports.getOutstandingByRole = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const role = normalizeRole(req.query.role);

    if (!["supplier", "customer"].includes(role)) {
      return res.status(400).json({ message: "role must be supplier or customer" });
    }

    const rangeFilter = buildRangeFilter(req);
    const data = await buildOutstandingForRole({ companyId, role, rangeFilter });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getSupplierOutstanding = async (req, res) => {
  req.query.role = "supplier";
  return exports.getOutstandingByRole(req, res);
};

exports.getVendorOutstanding = async (req, res) => {
  req.query.role = "customer";
  return exports.getOutstandingByRole(req, res);
};

exports.getCustomerOutstanding = async (req, res) => {
  req.query.role = "customer";
  return exports.getOutstandingByRole(req, res);
};

exports.getAllOutstanding = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const rangeFilter = buildRangeFilter(req);

    const supplier = await buildOutstandingForRole({
      companyId,
      role: "supplier",
      rangeFilter,
    });
    const customer = await buildOutstandingForRole({
      companyId,
      role: "customer",
      rangeFilter,
    });

    const map = {};
    [...supplier, ...customer].forEach((entry) => {
      const id = String(entry.partyId);
      if (!map[id]) {
        map[id] = {
          partyId: entry.partyId,
          partyName: entry.partyName,
          roles: [],
          payable: 0,
          receivable: 0,
        };
      }
      if (!map[id].roles.includes(entry.role)) map[id].roles.push(entry.role);
      if (entry.role === "supplier") map[id].payable = entry.outstanding;
      if (entry.role === "customer") map[id].receivable = entry.outstanding;
    });

    const report = Object.values(map).map((item) => ({
      ...item,
      netBalance: item.receivable - item.payable,
    }));

    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getAgeingByRole = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const role = normalizeRole(req.query.role);
    if (!["supplier", "customer"].includes(role)) {
      return res.status(400).json({ message: "role must be supplier or customer" });
    }

    const rangeFilter = buildRangeFilter(req);
    const invoices =
      role === "supplier"
        ? await PurchaseInvoice.find({ companyId, ...rangeFilter }).populate("partyId", "name")
        : await SalesInvoice.find({ companyId, ...rangeFilter }).populate("partyId", "name");

    const now = Date.now();
    const rows = {};

    invoices.forEach((inv) => {
      const pid = String(inv.partyId?._id || inv.partyId);
      if (!pid) return;
      const name = inv.partyId?.name || "Unknown";
      if (!rows[pid]) {
        rows[pid] = { id: pid, name, "0_30": 0, "31_60": 0, "61_plus": 0, total: 0 };
      }

      const outstanding = (inv.totalAmount || 0) - (inv.paidAmount || 0);
      if (outstanding <= 0) return;
      const ageDays = Math.floor((now - new Date(inv.invoiceDate).getTime()) / 86400000);

      if (ageDays <= 30) rows[pid]["0_30"] += outstanding;
      else if (ageDays <= 60) rows[pid]["31_60"] += outstanding;
      else rows[pid]["61_plus"] += outstanding;

      rows[pid].total += outstanding;
    });

    res.json(Object.values(rows));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

