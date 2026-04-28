const { getDateRangeFromQuery } = require("../utils/dateRange");
const {
  getPartyBalanceSummaries,
  getRoleOutstandingRows,
} = require("../utils/partyBalanceSummary");

const normalizeRole = (role = "") => {
  const value = String(role).toLowerCase();
  if (value === "vendor") return "customer";
  return value;
};

const buildOutstandingForRole = async ({ companyId, role, range, branchId, branchIsDefault }) =>
  getRoleOutstandingRows({ companyId, role, range, branchId, branchIsDefault });

exports.getOutstandingByRole = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const role = normalizeRole(req.query.role);

    if (!["supplier", "customer"].includes(role)) {
      return res.status(400).json({ message: "role must be supplier or customer" });
    }

    const range = getDateRangeFromQuery(req.query);
    const data = await buildOutstandingForRole({
      companyId,
      role,
      range,
      branchId: req.user.branchId,
      branchIsDefault: req.user.branchIsDefault,
    });
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
    const range = getDateRangeFromQuery(req.query);

    const supplier = await buildOutstandingForRole({
      companyId,
      role: "supplier",
      range,
      branchId: req.user.branchId,
      branchIsDefault: req.user.branchIsDefault,
    });
    const customer = await buildOutstandingForRole({
      companyId,
      role: "customer",
      range,
      branchId: req.user.branchId,
      branchIsDefault: req.user.branchIsDefault,
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

    const summaries = await getPartyBalanceSummaries({
      companyId,
      range: getDateRangeFromQuery(req.query),
      branchId: req.user.branchId,
      branchIsDefault: req.user.branchIsDefault,
    });

    const rows = summaries
      .filter((summary) => (summary.roles || []).includes(role))
      .map((summary) => {
        const outstanding =
          role === "supplier"
            ? summary.supplierOutstanding
            : summary.customerOutstanding;
        return {
          id: String(summary.partyId),
          name: summary.partyName,
          "0_30": outstanding,
          "31_60": 0,
          "61_plus": 0,
          total: outstanding,
        };
      });

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
