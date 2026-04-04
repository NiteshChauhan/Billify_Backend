const BankAccount = require("../models/BankAccount");
const SalesInvoice = require("../models/SalesInvoice");
const PurchaseInvoice = require("../models/PurchaseInvoice");
const Payment = require("../models/Payment");
const Expense = require("../models/Expense");

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

exports.updateBankAccount = async (req, res) => {
  try {
    const { accountName, accountNumber, balance } = req.body;

    if (!String(accountName || "").trim()) {
      return res.status(400).json({ message: "accountName is required" });
    }
    if (!String(accountNumber || "").trim()) {
      return res.status(400).json({ message: "accountNumber is required" });
    }

    const update = {
      accountName: String(accountName).trim(),
      accountNumber: String(accountNumber).trim(),
    };

    if (balance !== undefined) {
      const normalizedBalance = Number(balance || 0);
      if (Number.isNaN(normalizedBalance)) {
        return res.status(400).json({ message: "balance must be a number" });
      }
      update.balance = normalizedBalance;
    }

    const bankAccount = await BankAccount.findOneAndUpdate(
      { _id: req.params.id, companyId: req.user.companyId },
      update,
      { new: true },
    );

    if (!bankAccount) {
      return res.status(404).json({ message: "Bank account not found" });
    }

    res.json(bankAccount);
  } catch (err) {
    res.status(500).json({ message: "Failed to update bank account", error: err.message });
  }
};

exports.deleteBankAccount = async (req, res) => {
  try {
    const bankAccountId = req.params.id;
    const companyId = req.user.companyId;

    const account = await BankAccount.findOne({ _id: bankAccountId, companyId }).select("_id");
    if (!account) {
      return res.status(404).json({ message: "Bank account not found" });
    }

    const [usedInSales, usedInPurchases, usedInPayments, usedInExpenses] = await Promise.all([
      SalesInvoice.exists({ companyId, bankAccountId }),
      PurchaseInvoice.exists({ companyId, bankAccountId }),
      Payment.exists({ companyId, bankAccountId }),
      Expense.exists({ companyId, bankAccountId }),
    ]);

    if (usedInSales || usedInPurchases || usedInPayments || usedInExpenses) {
      return res.status(400).json({ message: "Bank account is already used in transactions and cannot be deleted" });
    }

    await BankAccount.deleteOne({ _id: bankAccountId, companyId });
    res.json({ message: "Bank account deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete bank account", error: err.message });
  }
};
