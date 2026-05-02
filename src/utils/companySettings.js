const Company = require("../models/Company");

const getCompanyGstEnabled = async (companyId) => {
  const company = await Company.findById(companyId).select("gstEnabled").lean();
  return company?.gstEnabled !== false;
};

module.exports = {
  getCompanyGstEnabled,
};
