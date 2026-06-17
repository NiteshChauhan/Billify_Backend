require("dotenv").config();
const connectDB = require("../src/config/db");
const SubscriptionPlan = require("../src/models/SubscriptionPlan");

const defaultPlans = [
  {
    name: "Trial",
    code: "TRIAL",
    price: 0,
    durationType: "days",
    durationValue: 15,
    maxBranches: 1,
    maxUsers: 2,
    maxInvoicesPerMonth: 50,
    isTrial: true,
    sortOrder: 1,
  },
  {
    name: "Basic",
    code: "BASIC",
    price: 999,
    durationType: "months",
    durationValue: 1,
    maxBranches: 3,
    maxUsers: 10,
    maxInvoicesPerMonth: 500,
    sortOrder: 2,
  },
  {
    name: "Standard",
    code: "STANDARD",
    price: 2499,
    durationType: "months",
    durationValue: 1,
    maxBranches: 10,
    maxUsers: 25,
    maxInvoicesPerMonth: 2000,
    sortOrder: 3,
  },
  {
    name: "Premium",
    code: "PREMIUM",
    price: 4999,
    durationType: "months",
    durationValue: 1,
    maxBranches: 25,
    maxUsers: 100,
    maxInvoicesPerMonth: 10000,
    sortOrder: 4,
  },
  {
    name: "Enterprise",
    code: "ENTERPRISE",
    price: 9999,
    durationType: "months",
    durationValue: 1,
    maxBranches: 999,
    maxUsers: 999,
    maxInvoicesPerMonth: 999999,
    sortOrder: 5,
  },
];

const run = async () => {
  await connectDB();

  for (const plan of defaultPlans) {
    await SubscriptionPlan.updateOne(
      { code: plan.code },
      {
        $setOnInsert: {
          ...plan,
          currency: "INR",
          description: "",
          features: [],
          isActive: true,
          isDeleted: false,
        },
      },
      { upsert: true },
    );
  }

  console.log("Default subscription plans seeded");
  process.exit(0);
};

run().catch((err) => {
  console.error("Failed to seed subscription plans");
  console.error(err.message);
  process.exit(1);
});
