const mongoose = require("mongoose");

const superAdminSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, required: true },
    email: { type: String, trim: true, lowercase: true, unique: true, required: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ["SUPER_ADMIN"],
      default: "SUPER_ADMIN",
    },
    isActive: { type: Boolean, default: true },
    lastLoginAt: Date,
  },
  { timestamps: true },
);

module.exports = mongoose.model("SuperAdmin", superAdminSchema);
