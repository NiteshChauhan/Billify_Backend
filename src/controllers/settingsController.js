const Company = require("../models/Company");

exports.getCompanySettings = async (req, res) => {
  try {
    const company = await Company.findById(req.user.companyId).select("name mobile email address gstNumber currencySymbol");
    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }
    res.json(company);
  } catch (err) {
    res.status(500).json({ message: "Failed to load company profile", error: err.message });
  }
};

exports.saveCompanySettings = async (req, res) => {
  try {
    const { name, mobile, email, address, gstNumber, currencySymbol } = req.body;

    if (!String(name || "").trim()) {
      return res.status(400).json({ message: "name is required" });
    }

    const company = await Company.findByIdAndUpdate(
      req.user.companyId,
      {
        name: String(name).trim(),
        mobile: String(mobile || "").trim(),
        email: String(email || "").trim(),
        address: String(address || "").trim(),
        gstNumber: String(gstNumber || "").trim(),
        currencySymbol: String(currencySymbol || "Rs").trim() || "Rs",
      },
      { new: true },
    ).select("name mobile email address gstNumber currencySymbol");

    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }

    res.json(company);
  } catch (err) {
    res.status(500).json({ message: "Failed to save company profile", error: err.message });
  }
};
