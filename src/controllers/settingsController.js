const Company = require("../models/Company");
const Branch = require("../models/Branch");

const CURRENCY_DECIMALS = {
  Rs: 2,
  $: 2,
  AED: 2,
  EUR: 2,
  KWD: 3,
  JOD: 3,
  OMR: 3,
};

const resolveCurrencyDecimals = (currencySymbol, requestedDecimals) => {
  if (requestedDecimals !== undefined && requestedDecimals !== null && requestedDecimals !== "") {
    const parsed = Number(requestedDecimals);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 6) {
      return parsed;
    }
  }
  return CURRENCY_DECIMALS[String(currencySymbol || "Rs").trim()] ?? 2;
};

exports.getCompanySettings = async (req, res) => {
  try {
    const company = await Company.findById(req.user.companyId).select(
      "name nameAr mobile whatsapp email address addressAr gstNumber currencySymbol currencyDecimals pdfLanguage stockSettlementEnabled",
    );
    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }
    if (company.currencyDecimals === undefined || company.currencyDecimals === null) {
      company.currencyDecimals = resolveCurrencyDecimals(company.currencySymbol);
    }
    res.json(company);
  } catch (err) {
    res.status(500).json({ message: "Failed to load company profile", error: err.message });
  }
};

exports.saveCompanySettings = async (req, res) => {
  try {
    const {
      name,
      nameAr,
      mobile,
      whatsapp,
      email,
      address,
      addressAr,
      gstNumber,
      currencySymbol,
      currencyDecimals,
      pdfLanguage,
      stockSettlementEnabled,
    } = req.body;

    if (!String(name || "").trim()) {
      return res.status(400).json({ message: "name is required" });
    }

    const normalizedCurrencySymbol = String(currencySymbol || "Rs").trim() || "Rs";
    const normalizedCurrencyDecimals = resolveCurrencyDecimals(normalizedCurrencySymbol, currencyDecimals);
    const normalizedPdfLanguage = ["en", "hi", "ar"].includes(String(pdfLanguage || "").toLowerCase())
      ? String(pdfLanguage).toLowerCase()
      : "en";

    const company = await Company.findByIdAndUpdate(
      req.user.companyId,
      {
        name: String(name).trim(),
        nameAr: String(nameAr || "").trim(),
        mobile: String(mobile || "").trim(),
        whatsapp: String(whatsapp || "").trim(),
        email: String(email || "").trim(),
        address: String(address || "").trim(),
        addressAr: String(addressAr || "").trim(),
        gstNumber: String(gstNumber || "").trim(),
        currencySymbol: normalizedCurrencySymbol,
        currencyDecimals: normalizedCurrencyDecimals,
        pdfLanguage: normalizedPdfLanguage,
        stockSettlementEnabled: Boolean(stockSettlementEnabled),
      },
      { new: true },
    ).select(
      "name nameAr mobile whatsapp email address addressAr gstNumber currencySymbol currencyDecimals pdfLanguage stockSettlementEnabled",
    );

    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }

    res.json(company);
  } catch (err) {
    res.status(500).json({ message: "Failed to save company profile", error: err.message });
  }
};

exports.getBranchSummary = async (req, res) => {
  try {
    const branches = await Branch.find({ companyId: req.user.companyId }).sort({
      isDefault: -1,
      branchName: 1,
    });
    res.json(branches);
  } catch (err) {
    res.status(500).json({ message: "Failed to load branch summary", error: err.message });
  }
};
