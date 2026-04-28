const mongoose = require("mongoose");

const MAIN_BRANCH_ALIASES = new Set(["", "0", "main", "main_branch", "main-branch"]);

const isMainBranchAlias = (value) => {
  if (value === null || value === undefined) return true;
  return MAIN_BRANCH_ALIASES.has(String(value).trim().toLowerCase());
};

const getBranchValues = (branchId) => {
  if (isMainBranchAlias(branchId)) return [];
  const stringValue = String(branchId);
  if (!mongoose.Types.ObjectId.isValid(stringValue)) {
    return [];
  }
  return [new mongoose.Types.ObjectId(stringValue), stringValue];
};

const buildBranchFilter = (branchId, branchIsDefault = false) => {
  if (isMainBranchAlias(branchId)) {
    return {
      $or: [
        { branchId: { $exists: false } },
        { branchId: null },
      ],
    };
  }

  const branchValues = getBranchValues(branchId);
  if (!branchValues.length) {
    return { branchId: null, _id: { $exists: false } };
  }
  const selectedBranchFilter =
    branchValues.length > 1 ? { branchId: { $in: branchValues } } : { branchId: branchValues[0] };

  if (branchIsDefault) {
    return {
      $or: [
        selectedBranchFilter,
        { branchId: { $exists: false } },
        { branchId: null },
      ],
    };
  }

  return selectedBranchFilter;
};

const withBranchScope = (query = {}, branchId, branchIsDefault = false) => {
  const branchFilter = buildBranchFilter(branchId, branchIsDefault);
  const { branchId: _unsafeBranchId, ...baseQuery } = query;
  if (query.$or && branchFilter.$or) {
    return { $and: [baseQuery, branchFilter] };
  }
  return {
    ...baseQuery,
    ...branchFilter,
  };
};

const getUserBranchId = (user = {}) => user.branchId || null;

const isUserDefaultBranch = (user = {}) => Boolean(user.branchIsDefault);

const withUserBranchScope = (query = {}, user = {}) =>
  withBranchScope(query, getUserBranchId(user), isUserDefaultBranch(user));

module.exports = {
  withBranchScope,
  withUserBranchScope,
  buildBranchFilter,
  getUserBranchId,
  isUserDefaultBranch,
  isMainBranchAlias,
};
