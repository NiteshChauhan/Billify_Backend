const mongoose = require("mongoose");

const MAIN_BRANCH_ALIASES = new Set(["0", "main", "main_branch", "main-branch"]);

const isTruthyMainAlias = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return !normalized || MAIN_BRANCH_ALIASES.has(normalized);
};

const toValidObjectIdString = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized || !mongoose.Types.ObjectId.isValid(normalized)) {
    return null;
  }
  return normalized;
};

const normalizeBranchScope = (branchScope) => {
  if (!branchScope) {
    return { branchId: null, isMainBranch: false };
  }

  if (typeof branchScope === "object") {
    const rawBranchId = branchScope.branchId || branchScope._id || branchScope.id || "";
    return {
      branchId: toValidObjectIdString(rawBranchId),
      isMainBranch:
        Boolean(branchScope.isDefault || branchScope.isMainBranch) ||
        isTruthyMainAlias(rawBranchId),
    };
  }

  return {
    branchId: toValidObjectIdString(branchScope),
    isMainBranch: isTruthyMainAlias(branchScope),
  };
};

const buildLegacyMainBranchClause = (branchId) => ({
  $or: [
    { branchId },
    { branchId: null },
    { branchId: { $exists: false } },
  ],
});

const withBranchScope = (query = {}, branchScope) => {
  const { branchId, isMainBranch } = normalizeBranchScope(branchScope);
  if (!branchId && !isMainBranch) {
    return query;
  }

  if (isMainBranch) {
    if (!branchId) {
      return {
        $and: [query, { $or: [{ branchId: null }, { branchId: { $exists: false } }] }],
      };
    }
    return {
      $and: [query, buildLegacyMainBranchClause(branchId)],
    };
  }

  return {
    ...query,
    branchId,
  };
};

module.exports = {
  MAIN_BRANCH_ALIASES,
  toValidObjectIdString,
  normalizeBranchScope,
  buildLegacyMainBranchClause,
  withBranchScope,
};
