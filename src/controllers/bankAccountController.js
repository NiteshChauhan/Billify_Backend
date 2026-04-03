const BankAccount = require("../models/BankAccount");

exports.createBankAccount = async (req, res) => {
  try {
    const { accountName, accountNumber, balance = 0 } = req.body;

    if (!String(accountName || "").trim()) {
      return res.status(400).json({ message: "accountName is required" });
    }
    if (!String(accountNumber || "").trim()) {
      return res.status(400).json({ message: "accountNumber is required" });
    }

    const normalizedBalance = Number(balance || 0);
    if (Number.isNaN(normalizedBalance)) {
      return res.status(400).json({ message: "balance must be a number" });
    }

    const bankAccount = await BankAccount.create({
      companyId: req.user.companyId,
      accountName: String(accountName).trim(),
      accountNumber: String(accountNumber).trim(),
      balance: normalizedBalance,
    });

    res.json(bankAccount);
  } catch (err) {
    res.status(500).json({ message: "Failed to create bank account", error: err.message });
  }
};

exports.getBankAccounts = async (req, res) => {
  try {
    const accounts = await BankAccount.find({ companyId: req.user.companyId }).sort({ createdAt: -1 });
    res.json(accounts);
  } catch (err) {
    res.status(500).json({ message: "Failed to load bank accounts", error: err.message });
  }
};
