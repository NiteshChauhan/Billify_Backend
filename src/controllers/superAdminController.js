const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const SuperAdmin = require("../models/SuperAdmin");
const User = require("../models/User");
const Company = require("../models/Company");
const Branch = require("../models/Branch");
const SubscriptionPlan = require("../models/SubscriptionPlan");
const AdminSubscription = require("../models/AdminSubscription");
const SuperAdminAuditLog = require("../models/SuperAdminAuditLog");
const SalesInvoice = require("../models/SalesInvoice");
const PurchaseInvoice = require("../models/PurchaseInvoice");
const Payment = require("../models/Payment");
const Party = require("../models/Party");
const { addDuration, applySubscriptionToCompany, getUsageForCompany, startOfMonth, endOfMonth } = require("../utils/subscription");

const safeUserSelect = "-password";

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

const logSuperAdminAction = async (req, payload) => {
  try {
    await SuperAdminAuditLog.create({
      superAdminId: req.superAdmin?._id || req.superAdmin?.superAdminId,
      ipAddress: req.ip,
      ...payload,
    });
  } catch (err) {
    console.warn("[SUPER_ADMIN_AUDIT] Failed to log action", err.message);
  }
};

const buildPagination = (query) => {
  const page = Math.max(1, Number(query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(query.limit || 20)));
  return { page, limit, skip: (page - 1) * limit };
};

const parseDate = (value, fallback = new Date()) => {
  const date = value ? new Date(value) : fallback;
  return Number.isNaN(date.getTime()) ? fallback : date;
};

const serializeAdmin = (admin) => {
  const doc = admin?.toObject ? admin.toObject() : admin;
  if (!doc) return null;
  delete doc.password;
  return doc;
};

const getAdminWithCompany = async (id) =>
  User.findOne({ _id: id, role: "admin" }).select(safeUserSelect).populate("companyId");

const createSubscriptionPayload = async (body, admin, superAdminId, existing = null) => {
  const plan = body.planId ? await SubscriptionPlan.findById(body.planId) : null;
  const billingMode = ["manual", "dynamic"].includes(body.billingMode) ? body.billingMode : "manual";
  const startDate = parseDate(body.startDate, existing?.startDate || new Date());
  const dynamicEndDate = plan
    ? addDuration(startDate, plan.durationType, plan.durationValue)
    : addDuration(startDate, "days", 15);
  const endDate = parseDate(body.endDate, billingMode === "dynamic" ? dynamicEndDate : existing?.endDate || dynamicEndDate);
  const status = body.status || (plan?.code === "TRIAL" ? "trial" : "active");

  return {
    adminId: admin._id,
    companyId: admin.companyId?._id || admin.companyId,
    planId: plan?._id || body.planId || existing?.planId,
    planName: plan?.name || body.planName || existing?.planName || "Manual Plan",
    startDate,
    endDate,
    status,
    billingMode,
    maxBranches: Number(body.maxBranches ?? plan?.maxBranches ?? existing?.maxBranches ?? 1),
    maxUsers: Number(body.maxUsers ?? plan?.maxUsers ?? existing?.maxUsers ?? 3),
    maxInvoicesPerMonth: Number(
      body.maxInvoicesPerMonth ?? plan?.maxInvoicesPerMonth ?? existing?.maxInvoicesPerMonth ?? 100,
    ),
    updatedBySuperAdmin: superAdminId,
  };
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const superAdmin = await SuperAdmin.findOne({ email: normalizeEmail(email) });
    if (!superAdmin || superAdmin.isActive === false) {
      return res.status(400).json({ success: false, message: "Invalid credentials" });
    }

    const match = await bcrypt.compare(String(password || ""), superAdmin.password);
    if (!match) {
      return res.status(400).json({ success: false, message: "Invalid credentials" });
    }

    superAdmin.lastLoginAt = new Date();
    await superAdmin.save();

    const token = jwt.sign(
      { superAdminId: superAdmin._id, role: "SUPER_ADMIN" },
      process.env.JWT_SECRET,
      { expiresIn: "1d" },
    );

    await logSuperAdminAction(req, {
      superAdminId: superAdmin._id,
      action: "LOGIN",
      module: "auth",
      entityType: "SuperAdmin",
      entityId: superAdmin._id,
      details: { email: superAdmin.email },
    });

    res.json({
      success: true,
      token,
      user: {
        _id: superAdmin._id,
        name: superAdmin.name,
        email: superAdmin.email,
        role: superAdmin.role,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to login", error: err.message });
  }
};

exports.profile = async (req, res) => {
  res.json({ success: true, user: req.superAdmin });
};

exports.listAdmins = async (req, res) => {
  try {
    const { page, limit, skip } = buildPagination(req.query);
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").toLowerCase();
    const query = { role: "admin" };
    if (status === "active") query.isActive = true;
    if (status === "inactive") query.isActive = false;
    if (search) {
      query.$or = [
        { name: new RegExp(search, "i") },
        { email: new RegExp(search, "i") },
      ];
    }

    const [admins, total] = await Promise.all([
      User.find(query).select(safeUserSelect).populate("companyId").sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(query),
    ]);

    const subscriptionMap = new Map(
      (
        await AdminSubscription.find({
          adminId: { $in: admins.map((admin) => admin._id) },
        }).populate("planId")
      ).map((sub) => [String(sub.adminId), sub]),
    );

    res.json({
      success: true,
      data: admins.map((admin) => ({
        ...serializeAdmin(admin),
        subscription: subscriptionMap.get(String(admin._id)) || null,
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to load admins", error: err.message });
  }
};

exports.createAdmin = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const { name, email, password, companyName, companyCode, contactNumber } = req.body;
    if (!name || !email || !password || !companyName) {
      return res.status(400).json({ success: false, message: "name, email, password and companyName are required" });
    }

    let createdAdmin;
    await session.withTransaction(async () => {
      const existing = await User.findOne({ email: normalizeEmail(email) }).session(session);
      if (existing) throw new Error("Email already exists");

      const company = await Company.create(
        [
          {
            name: companyName,
            companyCode: String(companyCode || "").trim() || undefined,
            contactNumber,
            mobile: contactNumber,
            isActive: true,
            status: "active",
            accountStatus: "active",
            subscriptionStatus: "trial",
            subscriptionExpiry: addDuration(new Date(), "days", 15),
            createdBySuperAdmin: req.superAdmin._id,
          },
        ],
        { session },
      );

      const hashedPassword = await bcrypt.hash(password, 10);
      const admin = await User.create(
        [
          {
            companyId: company[0]._id,
            name,
            email: normalizeEmail(email),
            password: hashedPassword,
            role: "admin",
            contactNumber,
            isActive: true,
            accountStatus: "active",
            subscriptionStatus: "trial",
            createdBySuperAdmin: req.superAdmin._id,
          },
        ],
        { session },
      );

      await Branch.create(
        [
          {
            companyId: company[0]._id,
            branchName: "Main Branch",
            branchCode: "MAIN",
            type: "branch",
            status: "active",
            isDefault: true,
          },
        ],
        { session },
      );

      createdAdmin = admin[0];
    });

    await logSuperAdminAction(req, {
      action: "CREATE_ADMIN",
      module: "admins",
      entityType: "User",
      entityId: createdAdmin._id,
      details: { email: normalizeEmail(email), companyName },
    });

    res.status(201).json({ success: true, data: serializeAdmin(await getAdminWithCompany(createdAdmin._id)) });
  } catch (err) {
    res.status(err.message === "Email already exists" ? 400 : 500).json({
      success: false,
      message: err.message || "Failed to create admin",
    });
  } finally {
    session.endSession();
  }
};

exports.getAdmin = async (req, res) => {
  try {
    const admin = await getAdminWithCompany(req.params.id);
    if (!admin) return res.status(404).json({ success: false, message: "Admin not found" });
    const [subscription, usage] = await Promise.all([
      AdminSubscription.findOne({ adminId: admin._id }).populate("planId"),
      getUsageForCompany(admin.companyId._id),
    ]);
    res.json({ success: true, data: { ...serializeAdmin(admin), subscription, usage } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to load admin", error: err.message });
  }
};

exports.updateAdmin = async (req, res) => {
  try {
    const admin = await getAdminWithCompany(req.params.id);
    if (!admin) return res.status(404).json({ success: false, message: "Admin not found" });

    const userUpdates = ["name", "contactNumber"].reduce((acc, key) => {
      if (req.body[key] !== undefined) acc[key] = req.body[key];
      return acc;
    }, {});
    if (req.body.email) userUpdates.email = normalizeEmail(req.body.email);
    if (req.body.password) userUpdates.password = await bcrypt.hash(req.body.password, 10);

    await User.findByIdAndUpdate(admin._id, userUpdates);
    await Company.findByIdAndUpdate(admin.companyId._id, {
      ...(req.body.companyName !== undefined ? { name: req.body.companyName } : {}),
      ...(req.body.companyCode !== undefined ? { companyCode: req.body.companyCode } : {}),
      ...(req.body.contactNumber !== undefined ? { contactNumber: req.body.contactNumber, mobile: req.body.contactNumber } : {}),
      ...(req.body.companyEmail !== undefined ? { email: req.body.companyEmail } : {}),
    });

    await logSuperAdminAction(req, {
      action: "UPDATE_ADMIN",
      module: "admins",
      entityType: "User",
      entityId: admin._id,
      details: { fields: Object.keys(req.body || {}) },
    });

    res.json({ success: true, data: serializeAdmin(await getAdminWithCompany(admin._id)) });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to update admin", error: err.message });
  }
};

exports.updateAdminStatus = async (req, res) => {
  try {
    const admin = await getAdminWithCompany(req.params.id);
    if (!admin) return res.status(404).json({ success: false, message: "Admin not found" });
    const isActive = req.body.isActive !== undefined ? Boolean(req.body.isActive) : req.body.status !== "inactive";
    const status = isActive ? "active" : "inactive";
    await Promise.all([
      User.updateMany({ companyId: admin.companyId._id }, { isActive, accountStatus: status }),
      Company.findByIdAndUpdate(admin.companyId._id, { isActive, status, accountStatus: status }),
    ]);
    await logSuperAdminAction(req, {
      action: isActive ? "ACTIVATE_ADMIN" : "DEACTIVATE_ADMIN",
      module: "admins",
      entityType: "User",
      entityId: admin._id,
      details: { status },
    });
    res.json({ success: true, data: serializeAdmin(await getAdminWithCompany(admin._id)) });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to update status", error: err.message });
  }
};

exports.deleteAdmin = async (req, res) => {
  req.body.isActive = false;
  return exports.updateAdminStatus(req, res);
};

exports.getAdminSubscription = async (req, res) => {
  const admin = await getAdminWithCompany(req.params.adminId);
  if (!admin) return res.status(404).json({ success: false, message: "Admin not found" });
  const subscription = await AdminSubscription.findOne({ adminId: admin._id }).populate("planId");
  res.json({ success: true, data: subscription });
};

exports.upsertAdminSubscription = async (req, res) => {
  try {
    const admin = await getAdminWithCompany(req.params.adminId);
    if (!admin) return res.status(404).json({ success: false, message: "Admin not found" });

    const existing = await AdminSubscription.findOne({ adminId: admin._id });
    const payload = await createSubscriptionPayload(req.body, admin, req.superAdmin._id, existing);
    let subscription;
    if (existing) {
      Object.assign(existing, payload);
      subscription = await existing.save();
    } else {
      subscription = await AdminSubscription.create({
        ...payload,
        createdBySuperAdmin: req.superAdmin._id,
      });
    }
    await applySubscriptionToCompany(admin.companyId._id, subscription);
    await User.updateMany(
      { companyId: admin.companyId._id },
      { subscriptionId: subscription._id, subscriptionStatus: subscription.status },
    );
    await logSuperAdminAction(req, {
      action: existing ? "UPDATE_SUBSCRIPTION" : "CREATE_SUBSCRIPTION",
      module: "subscriptions",
      entityType: "AdminSubscription",
      entityId: subscription._id,
      details: { adminId: admin._id, status: subscription.status },
    });
    res.json({ success: true, data: subscription });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to save subscription", error: err.message });
  }
};

exports.renewAdminSubscription = async (req, res) => {
  try {
    const admin = await getAdminWithCompany(req.params.adminId);
    if (!admin) return res.status(404).json({ success: false, message: "Admin not found" });
    const existing = await AdminSubscription.findOne({ adminId: admin._id });
    if (!existing) return exports.upsertAdminSubscription(req, res);

    const previousEndDate = existing.endDate;
    const plan = existing.planId ? await SubscriptionPlan.findById(existing.planId) : null;
    const renewalStart = previousEndDate && new Date(previousEndDate) > new Date() ? new Date(previousEndDate) : new Date();
    existing.endDate = req.body.endDate
      ? parseDate(req.body.endDate)
      : addDuration(renewalStart, plan?.durationType || "months", plan?.durationValue || 1);
    existing.status = "active";
    existing.renewalHistory.push({
      previousEndDate,
      newEndDate: existing.endDate,
      planId: existing.planId,
      billingMode: existing.billingMode,
      note: req.body.note || "",
      updatedBySuperAdmin: req.superAdmin._id,
    });
    existing.updatedBySuperAdmin = req.superAdmin._id;
    await existing.save();
    await applySubscriptionToCompany(admin.companyId._id, existing);
    await User.updateMany({ companyId: admin.companyId._id }, { subscriptionStatus: "active", subscriptionId: existing._id });
    await logSuperAdminAction(req, {
      action: "RENEW_SUBSCRIPTION",
      module: "subscriptions",
      entityType: "AdminSubscription",
      entityId: existing._id,
      details: { adminId: admin._id, previousEndDate, endDate: existing.endDate },
    });
    res.json({ success: true, data: existing });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to renew subscription", error: err.message });
  }
};

exports.updateAdminLimits = async (req, res) => {
  req.body.billingMode = req.body.billingMode || "manual";
  return exports.upsertAdminSubscription(req, res);
};

exports.adminOverview = async (req, res) => {
  try {
    const admin = await getAdminWithCompany(req.params.adminId);
    if (!admin) return res.status(404).json({ success: false, message: "Admin not found" });
    const companyId = admin.companyId._id;
    const [usage, payments, purchases, salesTotal, customers] = await Promise.all([
      getUsageForCompany(companyId),
      Payment.countDocuments({ companyId }),
      PurchaseInvoice.countDocuments({ companyId }),
      SalesInvoice.aggregate([{ $match: { companyId } }, { $group: { _id: null, total: { $sum: "$totalAmount" } } }]),
      Party.countDocuments({ companyId, isActive: true }),
    ]);
    res.json({
      success: true,
      data: {
        admin: serializeAdmin(admin),
        usage: { ...usage, payments, purchases, customers },
        totals: { salesAmount: Number(salesTotal[0]?.total || 0) },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to load overview", error: err.message });
  }
};

const listCompanyRecords = (Model, select = "") => async (req, res) => {
  try {
    const admin = await getAdminWithCompany(req.params.adminId);
    if (!admin) return res.status(404).json({ success: false, message: "Admin not found" });
    const { page, limit, skip } = buildPagination(req.query);
    const query = { companyId: admin.companyId._id };
    const [data, total] = await Promise.all([
      Model.find(query).select(select).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Model.countDocuments(query),
    ]);
    res.json({ success: true, data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to load records", error: err.message });
  }
};

exports.listAdminBranches = listCompanyRecords(Branch);
exports.listAdminUsers = listCompanyRecords(User, safeUserSelect);
exports.listAdminInvoices = listCompanyRecords(SalesInvoice);
exports.listAdminPayments = listCompanyRecords(Payment);

exports.dashboardStats = async (req, res) => {
  try {
    const now = new Date();
    const tenDays = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const [
      totalAdmins,
      activeAdmins,
      inactiveAdmins,
      expiredSubscriptions,
      expiringSoon,
      totalBranches,
      revenue,
    ] = await Promise.all([
      User.countDocuments({ role: "admin" }),
      User.countDocuments({ role: "admin", isActive: true }),
      User.countDocuments({ role: "admin", isActive: false }),
      AdminSubscription.countDocuments({ $or: [{ status: "expired" }, { endDate: { $lt: now } }] }),
      AdminSubscription.countDocuments({ status: { $in: ["active", "trial"] }, endDate: { $gte: now, $lte: tenDays } }),
      Branch.countDocuments({ status: "active" }),
      Payment.aggregate([{ $match: { createdAt: { $gte: startOfMonth(), $lt: endOfMonth() } } }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
    ]);

    res.json({
      success: true,
      data: {
        totalAdmins,
        activeAdmins,
        inactiveAdmins,
        expiredSubscriptions,
        expiringSoon,
        totalBranches,
        totalRevenue: Number(revenue[0]?.total || 0),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to load dashboard stats", error: err.message });
  }
};

exports.auditLogs = async (req, res) => {
  const { page, limit, skip } = buildPagination(req.query);
  const [data, total] = await Promise.all([
    SuperAdminAuditLog.find().populate("superAdminId", "name email").sort({ createdAt: -1 }).skip(skip).limit(limit),
    SuperAdminAuditLog.countDocuments(),
  ]);
  res.json({ success: true, data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
};
