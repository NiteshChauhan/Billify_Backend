const CompanyBalance = require("../models/CompanyBalance");

const startOfDay = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

exports.getCompanyBalance = async (req, res) => {
  try {
    const date = req.query.date;
    if (!date) {
      return res.status(400).json({ message: "date is required" });
    }

    const record = await CompanyBalance.findOne({
      companyId: req.user.companyId,
      date: startOfDay(date),
    });

    res.json(record || null);
  } catch (err) {
    res.status(500).json({ message: "Failed to load company balance", error: err.message });
  }
};

exports.saveCompanyBalance = async (req, res) => {
  try {
    const { date, openingBalance } = req.body;
    if (!date) {
      return res.status(400).json({ message: "date is required" });
    }

    const normalizedOpeningBalance = Number(openingBalance || 0);
    if (Number.isNaN(normalizedOpeningBalance)) {
      return res.status(400).json({ message: "openingBalance must be a number" });
    }

    const record = await CompanyBalance.findOneAndUpdate(
      {
        companyId: req.user.companyId,
        date: startOfDay(date),
      },
      {
        companyId: req.user.companyId,
        date: startOfDay(date),
        openingBalance: normalizedOpeningBalance,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    res.json(record);
  } catch (err) {
    res.status(500).json({ message: "Failed to save company balance", error: err.message });
  }
};
