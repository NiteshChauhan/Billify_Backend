const Expense = require("../models/Expense");
const BankAccount = require("../models/BankAccount");
const { withBranchScope } = require("../utils/branchScope");

const startOfDay = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfDay = (value) => {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
};

exports.createExpense = async (req, res) => {
  try {
    const { date, title, amount, paymentType, note, bankAccountId } = req.body;

    if (!date) {
      return res.status(400).json({ message: "date is required" });
    }
    if (!String(title || "").trim()) {
      return res.status(400).json({ message: "title is required" });
    }

    const normalizedAmount = Number(amount || 0);
    if (!(normalizedAmount > 0)) {
      return res.status(400).json({ message: "amount must be greater than 0" });
    }

    const normalizedPaymentType = String(paymentType || "").toLowerCase();
    if (!["cash", "bank"].includes(normalizedPaymentType)) {
      return res.status(400).json({ message: "paymentType must be cash or bank" });
    }

    let resolvedBankAccountId = null;
    if (normalizedPaymentType === "bank") {
      if (!bankAccountId) {
        return res.status(400).json({ message: "bankAccountId is required for bank expenses" });
      }
      const bankAccount = await BankAccount.findOne({
        _id: bankAccountId,
        companyId: req.user.companyId,
      }).select("_id");
      if (!bankAccount) {
        return res.status(400).json({ message: "Invalid bank account" });
      }
      resolvedBankAccountId = bankAccount._id;
    }

    const expense = await Expense.create({
      companyId: req.user.companyId,
      branchId: req.user.branchId || null,
      date: startOfDay(date),
      title: String(title).trim(),
      amount: normalizedAmount,
      paymentType: normalizedPaymentType,
      bankAccountId: resolvedBankAccountId,
      note: String(note || "").trim(),
    });

    const populated = await Expense.findById(expense._id).populate("bankAccountId", "accountName accountNumber");
    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: "Failed to create expense", error: err.message });
  }
};

exports.getExpenses = async (req, res) => {
  try {
    const status = String(req.query.status || "active").toLowerCase();
    const query = withBranchScope(
      {
        companyId: req.user.companyId,
        ...(status === "deleted" ? { isDeleted: true } : {}),
      },
      req.user.branchId,
      req.user.branchIsDefault,
    );
    const withDeleted = status === "deleted" || status === "all";
    if (req.query.date) {
      query.date = { $gte: startOfDay(req.query.date), $lte: endOfDay(req.query.date) };
    }

    const expenses = await Expense.find(query)
      .setOptions({ withDeleted })
      .populate("bankAccountId", "accountName accountNumber")
      .sort({ date: 1, createdAt: 1 });

    res.json(expenses);
  } catch (err) {
    res.status(500).json({ message: "Failed to load expenses", error: err.message });
  }
};

exports.updateExpense = async (req, res) => {
  try {
    const { date, title, amount, paymentType, note, bankAccountId } = req.body;

    if (!date) {
      return res.status(400).json({ message: "date is required" });
    }
    if (!String(title || "").trim()) {
      return res.status(400).json({ message: "title is required" });
    }

    const normalizedAmount = Number(amount || 0);
    if (!(normalizedAmount > 0)) {
      return res.status(400).json({ message: "amount must be greater than 0" });
    }

    const normalizedPaymentType = String(paymentType || "").toLowerCase();
    if (!["cash", "bank"].includes(normalizedPaymentType)) {
      return res.status(400).json({ message: "paymentType must be cash or bank" });
    }

    let resolvedBankAccountId = null;
    if (normalizedPaymentType === "bank") {
      if (!bankAccountId) {
        return res.status(400).json({ message: "bankAccountId is required for bank expenses" });
      }
      const bankAccount = await BankAccount.findOne({
        _id: bankAccountId,
        companyId: req.user.companyId,
      }).select("_id");
      if (!bankAccount) {
        return res.status(400).json({ message: "Invalid bank account" });
      }
      resolvedBankAccountId = bankAccount._id;
    }

    const expense = await Expense.findOneAndUpdate(
      withBranchScope(
        { _id: req.params.id, companyId: req.user.companyId },
        req.user.branchId,
        req.user.branchIsDefault,
      ),
      {
        date: startOfDay(date),
        title: String(title).trim(),
        amount: normalizedAmount,
        paymentType: normalizedPaymentType,
        bankAccountId: resolvedBankAccountId,
        note: String(note || "").trim(),
      },
      { new: true },
    ).populate("bankAccountId", "accountName accountNumber");

    if (!expense) {
      return res.status(404).json({ message: "Expense not found" });
    }

    res.json(expense);
  } catch (err) {
    res.status(500).json({ message: "Failed to update expense", error: err.message });
  }
};

exports.deleteExpense = async (req, res) => {
  try {
    const expense = await Expense.findOne(
      withBranchScope(
        { _id: req.params.id, companyId: req.user.companyId },
        req.user.branchId,
        req.user.branchIsDefault,
      ),
    );

    if (!expense) {
      return res.status(404).json({ message: "Expense not found" });
    }

    expense.isDeleted = true;
    expense.deletedAt = new Date();
    expense.deletedBy = req.user._id || null;
    await expense.save();

    res.json({ message: "Expense deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete expense", error: err.message });
  }
};

exports.restoreExpense = async (req, res) => {
  try {
    const expense = await Expense.findOne(
      withBranchScope(
        { _id: req.params.id, companyId: req.user.companyId, isDeleted: true },
        req.user.branchId,
        req.user.branchIsDefault,
      ),
    ).setOptions({ withDeleted: true });

    if (!expense) {
      return res.status(404).json({ message: "Deleted expense not found" });
    }

    expense.isDeleted = false;
    expense.deletedAt = null;
    expense.deletedBy = null;
    await expense.save();

    const populated = await Expense.findById(expense._id)
      .setOptions({ withDeleted: true })
      .populate("bankAccountId", "accountName accountNumber");
    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: "Failed to restore expense", error: err.message });
  }
};
