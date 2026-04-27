const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Company = require("../models/Company");
const Branch = require("../models/Branch");
const { logAudit } = require("../utils/auditLog");
const { ensureDefaultBranch, getSelectedBranchForCompany } = require("../utils/branchContext");

exports.registerAdmin = async (req, res) => {
  try {
    const { companyName, companyCode, name, email, password } = req.body;

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: "Email already exists" });

    const company = await Company.create({
      name: companyName,
      companyCode: String(companyCode || "").trim() || undefined,
      subscriptionExpiry: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000) // 15 days trial
    });

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      companyId: company._id,
      name,
      email,
      password: hashedPassword,
      role: "admin"
    });

    await Branch.create({
      companyId: company._id,
      branchName: "Main Branch",
      branchCode: "MAIN",
      type: "branch",
      status: "active",
      isDefault: true,
    });

    await logAudit({
      companyId: company._id,
      userId: user._id,
      actionType: "REGISTER",
      module: "auth",
      entityId: user._id,
      description: "Admin account registered",
      details: { email },
    });

    res.json({ message: "Admin registered successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).populate("companyId");
    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ message: "Invalid credentials" });

    const { branches, selectedBranch } = await getSelectedBranchForCompany(user.companyId._id, null);

    const token = jwt.sign(
      { userId: user._id, companyId: user.companyId._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    await logAudit({
      companyId: user.companyId._id,
      userId: user._id,
      actionType: "LOGIN",
      module: "auth",
      entityId: user._id,
      description: "User logged in",
      details: { email: user.email },
    });

    res.json({
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        companyId: user.companyId?._id || user.companyId,
        branches,
        selectedBranchId: selectedBranch?._id || null,
      },
      branches,
      selectedBranchId: selectedBranch?._id || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getSessionContext = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("_id name email role companyId isActive");
    if (!user || user.isActive === false) {
      return res.status(404).json({ message: "User not found" });
    }

    await ensureDefaultBranch(user.companyId);
    const { branches, selectedBranch } = await getSelectedBranchForCompany(
      user.companyId,
      req.user.branchId,
    );

    res.json({
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        companyId: user.companyId,
        branches,
        selectedBranchId: selectedBranch?._id || null,
      },
      branches,
      selectedBranchId: selectedBranch?._id || null,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to load session context", error: err.message });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ message: "oldPassword and newPassword are required" });
    }

    if (String(newPassword).length < 6) {
      return res.status(400).json({ message: "newPassword must be at least 6 characters" });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const match = await bcrypt.compare(oldPassword, user.password);
    if (!match) {
      return res.status(400).json({ message: "Old password is incorrect" });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    await logAudit({
      companyId: user.companyId,
      userId: user._id,
      actionType: "CHANGE_PASSWORD",
      module: "auth",
      entityId: user._id,
      description: "User changed password",
    });

    res.json({ message: "Password changed successfully" });
  } catch (err) {
    res.status(500).json({ message: "Failed to change password", error: err.message });
  }
};

exports.logout = async (req, res) => {
  try {
    await logAudit({
      companyId: req.user.companyId,
      userId: req.user.userId,
      actionType: "LOGOUT",
      module: "auth",
      entityId: req.user.userId,
      description: "User logged out",
    });
    res.json({ message: "Logged out successfully" });
  } catch (err) {
    res.status(500).json({ message: "Failed to logout", error: err.message });
  }
};
