const mongoose = require("mongoose");
const Company = require("../models/Company");
const Branch = require("../models/Branch");
const SalesInvoice = require("../models/SalesInvoice");
const PurchaseInvoice = require("../models/PurchaseInvoice");
const Expense = require("../models/Expense");
const Payment = require("../models/Payment");
const LoanEntry = require("../models/LoanEntry");
const CompanyBalance = require("../models/CompanyBalance");
const StockLedger = require("../models/StockLedger");
const StockBatch = require("../models/StockBatch");
const ReturnEntry = require("../models/Return");

const collections = [
  SalesInvoice,
  PurchaseInvoice,
  Expense,
  Payment,
  LoanEntry,
  CompanyBalance,
  StockLedger,
  StockBatch,
  ReturnEntry,
];

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  const companies = await Company.find({}).select("_id name");
  for (const company of companies) {
    let defaultBranch = await Branch.findOne({
      companyId: company._id,
      isDefault: true,
    });

    if (!defaultBranch) {
      defaultBranch = await Branch.findOne({ companyId: company._id }).sort({ createdAt: 1 });
    }

    if (!defaultBranch) {
      defaultBranch = await Branch.create({
        companyId: company._id,
        branchName: "Main Branch",
        branchCode: "MAIN",
        type: "branch",
        status: "active",
        isDefault: true,
      });
      console.log(`Created default branch for ${company.name}`);
    } else if (!defaultBranch.isDefault) {
      defaultBranch.isDefault = true;
      await defaultBranch.save();
    }

    await Branch.updateMany(
      { companyId: company._id, _id: { $ne: defaultBranch._id }, isDefault: true },
      { $set: { isDefault: false } },
    );

    for (const Model of collections) {
      const result = await Model.updateMany(
        { companyId: company._id, branchId: { $exists: false } },
        { $set: { branchId: defaultBranch._id } },
      );
      if (result.modifiedCount) {
        console.log(`${Model.modelName}: backfilled ${result.modifiedCount} records for ${company.name}`);
      }
    }
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
