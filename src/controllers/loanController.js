const LoanEntry = require("../models/LoanEntry");
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

const normalizePayload = async (companyId, body = {}) => {
  const normalizedType = String(body.type || "").toLowerCase();
  if (!["loan_in", "loan_out"].includes(normalizedType)) {
    throw new Error("type must be loan_in or loan_out");
  }

  const normalizedAmount = Number(body.amount || 0);
  if (!(normalizedAmount > 0)) {
    throw new Error("amount must be greater than 0");
  }

  if (!body.date) {
    throw new Error("date is required");
  }

  const normalizedPaymentType = String(body.paymentType || "").toLowerCase();
  if (!["cash", "bank"].includes(normalizedPaymentType)) {
    throw new Error("paymentType must be cash or bank");
  }

  let resolvedBankAccountId = null;
  if (normalizedPaymentType === "bank") {
    if (!body.bankAccountId) {
      throw new Error("bankAccountId is required for bank loans");
    }
    const account = await BankAccount.findOne({
      _id: body.bankAccountId,
      companyId,
    }).select("_id");
    if (!account) {
      throw new Error("Invalid bank account");
    }
    resolvedBankAccountId = account._id;
  }

  return {
    type: normalizedType,
    amount: normalizedAmount,
    date: startOfDay(body.date),
    note: String(body.note || "").trim(),
    paymentType: normalizedPaymentType,
    bankAccountId: resolvedBankAccountId,
  };
};

const computeRemainingState = (entries = []) => {
  const ordered = [...entries].sort((a, b) => {
    const dateDiff = new Date(a.date) - new Date(b.date);
    if (dateDiff !== 0) return dateDiff;
    const createdDiff = new Date(a.createdAt || a.date) - new Date(b.createdAt || b.date);
    if (createdDiff !== 0) return createdDiff;
    return String(a._id || "").localeCompare(String(b._id || ""));
  });

  const inflows = [];
  const updates = [];

  ordered.forEach((entry) => {
    const amount = Number(entry.amount || 0);
    if (entry.type === "loan_in") {
      const current = {
        id: String(entry._id || ""),
        remainingAmount: amount,
      };
      inflows.push(current);
      updates.push({ id: current.id, remainingAmount: amount });
      return;
    }

    let repaymentLeft = amount;
    for (const inflow of inflows) {
      if (repaymentLeft <= 0) break;
      if (!(inflow.remainingAmount > 0)) continue;
      const used = Math.min(inflow.remainingAmount, repaymentLeft);
      inflow.remainingAmount -= used;
      repaymentLeft -= used;
    }

    if (repaymentLeft > 0.000001) {
      throw new Error("Cannot repay more than remaining loan amount");
    }

    updates.push({ id: String(entry._id || ""), remainingAmount: 0 });
  });

  const inflowMap = new Map(inflows.map((item) => [item.id, item.remainingAmount]));
  return updates.map((item) => ({
    id: item.id,
    remainingAmount: inflowMap.has(item.id) ? inflowMap.get(item.id) : item.remainingAmount,
  }));
};

const recomputeAndPersist = async (companyId, branchId) => {
  const entries = await LoanEntry.find(withBranchScope({ companyId }, branchId))
    .sort({ date: 1, createdAt: 1, _id: 1 })
    .lean();
  const updates = computeRemainingState(entries);
  if (!updates.length) return;

  await LoanEntry.bulkWrite(
    updates.map((item) => ({
      updateOne: {
        filter: { _id: item.id, companyId, branchId: branchId || null },
        update: { $set: { remainingAmount: Number(item.remainingAmount || 0) } },
      },
    })),
  );
};

exports.createLoan = async (req, res) => {
  try {
    const branchScope = req.user.branchScope || req.user.branchId || null;
    const payload = await normalizePayload(req.user.companyId, req.body);
    const existing = await LoanEntry.find(withBranchScope({ companyId: req.user.companyId }, branchScope))
      .sort({ date: 1, createdAt: 1, _id: 1 }).lean();
    computeRemainingState([
      ...existing,
      {
        ...payload,
        _id: "pending-create",
        createdAt: new Date(),
      },
    ]);

    const entry = await LoanEntry.create({
      companyId: req.user.companyId,
      branchId: req.user.branchId || null,
      ...payload,
      remainingAmount: payload.type === "loan_in" ? payload.amount : 0,
    });

    await recomputeAndPersist(req.user.companyId, req.user.branchId || null);
    const populated = await LoanEntry.findById(entry._id).populate("bankAccountId", "accountName accountNumber");
    res.json(populated);
  } catch (err) {
    res.status(400).json({ message: err.message || "Failed to create loan entry" });
  }
};

exports.getLoans = async (req, res) => {
  try {
    const status = String(req.query.status || "active").toLowerCase();
    const withDeleted = status === "deleted" || status === "all";
    const query = withBranchScope(
      {
        companyId: req.user.companyId,
        ...(status === "deleted" ? { isDeleted: true } : {}),
      },
      req.user.branchScope || req.user.branchId || null,
    );
    if (req.query.date) {
      query.date = { $gte: startOfDay(req.query.date), $lte: endOfDay(req.query.date) };
    }
    const loans = await LoanEntry.find(query)
      .setOptions({ withDeleted })
      .populate("bankAccountId", "accountName accountNumber")
      .sort({ date: -1, createdAt: -1 });
    res.json(loans);
  } catch (err) {
    res.status(500).json({ message: "Failed to load loan entries", error: err.message });
  }
};

exports.updateLoan = async (req, res) => {
  try {
    const branchScope = req.user.branchScope || req.user.branchId || null;
    const existingEntry = await LoanEntry.findOne(withBranchScope({ _id: req.params.id, companyId: req.user.companyId }, branchScope))
      .setOptions({ withDeleted: true })
      .lean();

    if (!existingEntry) {
      return res.status(404).json({ message: "Loan entry not found" });
    }

    const payload = await normalizePayload(req.user.companyId, req.body);
    const entries = await LoanEntry.find(withBranchScope({ companyId: req.user.companyId, _id: { $ne: req.params.id } }, branchScope))
      .sort({ date: 1, createdAt: 1, _id: 1 })
      .lean();

    computeRemainingState([
      ...entries,
      {
        ...existingEntry,
        ...payload,
      },
    ]);

    await LoanEntry.updateOne(
      { _id: req.params.id, companyId: req.user.companyId, branchId: req.user.branchId || null },
      { $set: { ...payload, branchId: req.user.branchId || null } },
    );

    await recomputeAndPersist(req.user.companyId, req.user.branchId || null);
    const updated = await LoanEntry.findById(req.params.id).populate("bankAccountId", "accountName accountNumber");
    res.json(updated);
  } catch (err) {
    res.status(400).json({ message: err.message || "Failed to update loan entry" });
  }
};

exports.deleteLoan = async (req, res) => {
  try {
    const branchScope = req.user.branchScope || req.user.branchId || null;
    const existingEntry = await LoanEntry.findOne(withBranchScope({ _id: req.params.id, companyId: req.user.companyId }, branchScope)).lean();

    if (!existingEntry) {
      return res.status(404).json({ message: "Loan entry not found" });
    }

    const entries = await LoanEntry.find(withBranchScope({ companyId: req.user.companyId, _id: { $ne: req.params.id } }, branchScope))
      .sort({ date: 1, createdAt: 1, _id: 1 })
      .lean();

    computeRemainingState(entries);

    await LoanEntry.updateOne(
      { _id: req.params.id, companyId: req.user.companyId, branchId: req.user.branchId || null },
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
          deletedBy: req.user._id || null,
        },
      },
    );
    await recomputeAndPersist(req.user.companyId, req.user.branchId || null);
    res.json({ message: "Loan entry deleted successfully" });
  } catch (err) {
    res.status(400).json({ message: err.message || "Failed to delete loan entry" });
  }
};

exports.restoreLoan = async (req, res) => {
  try {
    const branchScope = req.user.branchScope || req.user.branchId || null;
    const existingEntry = await LoanEntry.findOne(withBranchScope({ _id: req.params.id, companyId: req.user.companyId, isDeleted: true }, branchScope))
      .setOptions({ withDeleted: true })
      .lean();

    if (!existingEntry) {
      return res.status(404).json({ message: "Deleted loan entry not found" });
    }

    const entries = await LoanEntry.find(withBranchScope({ companyId: req.user.companyId }, branchScope))
      .sort({ date: 1, createdAt: 1, _id: 1 })
      .lean();

    computeRemainingState([
      ...entries,
      {
        ...existingEntry,
        isDeleted: false,
      },
    ]);

    await LoanEntry.updateOne(
      { _id: req.params.id, companyId: req.user.companyId, branchId: req.user.branchId || null },
      {
        $set: {
          isDeleted: false,
          deletedAt: null,
          deletedBy: null,
        },
      },
    );

    await recomputeAndPersist(req.user.companyId, req.user.branchId || null);
    const restored = await LoanEntry.findById(req.params.id)
      .setOptions({ withDeleted: true })
      .populate("bankAccountId", "accountName accountNumber");
    res.json(restored);
  } catch (err) {
    res.status(400).json({ message: err.message || "Failed to restore loan entry" });
  }
};
