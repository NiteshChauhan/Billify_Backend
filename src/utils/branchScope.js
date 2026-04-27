const withBranchScope = (query = {}, branchId) => ({
  ...query,
  branchId: branchId || null,
});

module.exports = {
  withBranchScope,
};
