const Branch = require("../models/Branch");
const { isMainBranchAlias } = require("./branchScope");

const normalizeBranch = (branch) => ({
  _id: String(branch._id),
  branchName: branch.branchName,
  branchCode: branch.branchCode || "",
  type: branch.type,
  address: branch.address || "",
  phone: branch.phone || "",
  status: branch.status,
  isDefault: Boolean(branch.isDefault),
});

const listCompanyBranches = async (companyId, { includeInactive = false } = {}) => {
  const query = { companyId };
  if (!includeInactive) {
    query.status = "active";
  }
  const branches = await Branch.find(query).sort({ isDefault: -1, branchName: 1 }).lean();
  return branches.map(normalizeBranch);
};

const ensureDefaultBranch = async (companyId) => {
  let branch = await Branch.findOne({
    companyId,
    status: "active",
  }).sort({ isDefault: -1, createdAt: 1 });

  if (branch) {
    return branch;
  }

  branch = await Branch.create({
    companyId,
    branchName: "Main Branch",
    branchCode: "MAIN",
    type: "branch",
    status: "active",
    isDefault: true,
  });

  return branch;
};

const getSelectedBranchForCompany = async (companyId, requestedBranchId) => {
  const normalizedRequestedBranchId = isMainBranchAlias(requestedBranchId)
    ? null
    : requestedBranchId;
  const branches = await listCompanyBranches(companyId);
  if (!branches.length) {
    const branch = await ensureDefaultBranch(companyId);
    return {
      branches: [normalizeBranch(branch)],
      selectedBranch: normalizeBranch(branch),
      requestedValid: !normalizedRequestedBranchId || String(branch._id) === String(normalizedRequestedBranchId),
    };
  }

  let selectedBranch = null;
  let requestedValid = true;

  if (normalizedRequestedBranchId) {
    selectedBranch =
      branches.find((branch) => String(branch._id) === String(normalizedRequestedBranchId)) || null;
    requestedValid = Boolean(selectedBranch);
  }

  if (!selectedBranch) {
    selectedBranch = branches.find((branch) => branch.isDefault) || branches[0] || null;
  }

  return { branches, selectedBranch, requestedValid };
};

module.exports = {
  listCompanyBranches,
  ensureDefaultBranch,
  getSelectedBranchForCompany,
};
