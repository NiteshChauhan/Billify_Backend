require("dotenv").config();
const bcrypt = require("bcrypt");
const connectDB = require("../config/db");
const SuperAdmin = require("../models/SuperAdmin");

const run = async () => {
  await connectDB();

  const name = process.env.SUPER_ADMIN_NAME || "Platform Owner";
  const email = String(process.env.SUPER_ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD || "";

  if (!email || !password) {
    throw new Error("SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD are required");
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const superAdmin = await SuperAdmin.findOneAndUpdate(
    { email },
    {
      name,
      email,
      password: hashedPassword,
      role: "SUPER_ADMIN",
      isActive: true,
    },
    { new: true, upsert: true },
  ).select("_id name email role isActive");

  console.log("Super Admin ready:", superAdmin.email);
  process.exit(0);
};

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
