const Company = require("../models/Company");
const User = require("../models/User");
const Product = require("../models/Product");
const Party = require("../models/Party");
const SalesInvoice = require("../models/SalesInvoice");
const PurchaseInvoice = require("../models/PurchaseInvoice");
const ReturnEntry = require("../models/Return");
const Payment = require("../models/Payment");
const Expense = require("../models/Expense");
const LoanEntry = require("../models/LoanEntry");
const BankAccount = require("../models/BankAccount");
const CompanyBalance = require("../models/CompanyBalance");
const StockBatch = require("../models/StockBatch");
const StockLedger = require("../models/StockLedger");
const { logAudit } = require("../utils/auditLog");

const APP_VERSION = "backup-v1";

const companyScopedModels = [
  { key: "products", model: Product },
  { key: "parties", model: Party },
  { key: "sales", model: SalesInvoice },
  { key: "purchases", model: PurchaseInvoice },
  { key: "returns", model: ReturnEntry },
  { key: "payments", model: Payment },
  { key: "expenses", model: Expense },
  { key: "loans", model: LoanEntry },
  { key: "bankAccounts", model: BankAccount },
  { key: "companyBalances", model: CompanyBalance },
  { key: "stockBatches", model: StockBatch },
  { key: "stockLedger", model: StockLedger },
];

exports.downloadBackup = async (req, res) => {
  try {
    const companyId = String(req.user.companyId);
    const userId = String(req.user.userId);
    const [company, user, ...datasets] = await Promise.all([
      Company.findById(companyId).lean(),
      User.findById(userId).select("_id email name role companyId").lean(),
      ...companyScopedModels.map(({ model }) => model.find({ companyId }).setOptions({ withDeleted: true }).lean()),
    ]);

    if (!company || !user) {
      return res.status(404).json({ message: "Company or user not found for backup" });
    }

    const data = companyScopedModels.reduce((acc, { key }, index) => {
      acc[key] = datasets[index] || [];
      return acc;
    }, {});

    const backup = {
      meta: {
        version: APP_VERSION,
        exportedAt: new Date().toISOString(),
        companyId,
        companyName: company.name || "",
        exportedByUserId: userId,
        exportedByEmail: user.email || "",
      },
      company,
      data,
    };

    const safeCompanyName = String(company.name || "billing-backup").replace(/[^\w-]+/g, "_");
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeCompanyName}-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    );
    await logAudit({
      companyId,
      userId,
      actionType: "BACKUP_EXPORT",
      module: "backup",
      description: "Backup exported",
      details: { version: APP_VERSION },
    });
    res.json(backup);
  } catch (err) {
    res.status(500).json({ message: err.message || "Failed to export backup" });
  }
};

exports.restoreBackup = async (req, res) => {
  try {
    const payload = req.body?.backup || req.body;
    const meta = payload?.meta || {};
    const data = payload?.data || {};
    const companyId = String(req.user.companyId);
    const userId = String(req.user.userId);

    const currentUser = await User.findById(userId).select("_id email companyId").lean();
    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!meta.companyId || String(meta.companyId) !== companyId) {
      return res.status(400).json({ message: "Backup does not belong to this company" });
    }

    const emailMatches =
      meta.exportedByEmail &&
      currentUser.email &&
      String(meta.exportedByEmail).toLowerCase() === String(currentUser.email).toLowerCase();
    const userMatches = meta.exportedByUserId && String(meta.exportedByUserId) === userId;

    if (!userMatches && !emailMatches) {
      return res.status(400).json({ message: "Backup can only be restored by the same account" });
    }

    if (!req.body?.confirmRestore) {
      return res.status(400).json({ message: "Restore confirmation is required" });
    }

    const deleteOrder = [
      StockLedger,
      StockBatch,
      Payment,
      ReturnEntry,
      SalesInvoice,
      PurchaseInvoice,
      Expense,
      LoanEntry,
      BankAccount,
      CompanyBalance,
      Product,
      Party,
    ];

    for (const Model of deleteOrder) {
      await Model.deleteMany({ companyId });
    }

    if (payload.company && String(payload.company._id || "") === companyId) {
      const companyDoc = { ...payload.company };
      delete companyDoc.createdAt;
      delete companyDoc.updatedAt;
      await Company.findByIdAndUpdate(companyId, companyDoc, {
        upsert: true,
        new: true,
        runValidators: false,
      });
    }

    for (const { key, model } of companyScopedModels) {
      const docs = Array.isArray(data[key]) ? data[key] : [];
      if (!docs.length) continue;
      const normalized = docs.map((doc) => {
        const next = { ...doc, companyId };
        delete next.createdAt;
        delete next.updatedAt;
        return next;
      });
      await model.insertMany(normalized, { ordered: false });
    }

    await logAudit({
      companyId,
      userId,
      actionType: "BACKUP_RESTORE",
      module: "backup",
      description: "Backup restored",
      details: {
        version: meta.version || APP_VERSION,
        exportedAt: meta.exportedAt || null,
      },
    });

    res.json({
      message: "Backup restored successfully",
      restoredCounts: companyScopedModels.reduce((acc, { key }) => {
        acc[key] = Array.isArray(data[key]) ? data[key].length : 0;
        return acc;
      }, {}),
    });
  } catch (err) {
    res.status(500).json({ message: err.message || "Failed to restore backup" });
  }
};
