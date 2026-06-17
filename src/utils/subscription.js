const AdminSubscription = require("../models/AdminSubscription");
const Company = require("../models/Company");
const SalesInvoice = require("../models/SalesInvoice");
const Branch = require("../models/Branch");
const User = require("../models/User");

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const startOfMonth = (date = new Date()) => new Date(date.getFullYear(), date.getMonth(), 1);

const endOfMonth = (date = new Date()) =>
  new Date(date.getFullYear(), date.getMonth() + 1, 1);

const addDuration = (date, durationType, durationValue) => {
  const next = new Date(date);
  const value = Number(durationValue || 1);
  if (durationType === "years") next.setFullYear(next.getFullYear() + value);
  else if (durationType === "months") next.setMonth(next.getMonth() + value);
  else next.setDate(next.getDate() + value);
  return next;
};

const getDaysLeft = (endDate) => {
  if (!endDate) return null;
  return Math.ceil((new Date(endDate).getTime() - Date.now()) / MS_PER_DAY);
};

const getSubscriptionState = async (companyId, adminId = null) => {
  const [company, subscription] = await Promise.all([
    Company.findById(companyId).select("_id isActive status subscriptionExpiry subscriptionStatus"),
    AdminSubscription.findOne({
      companyId,
      ...(adminId ? { adminId } : {}),
    }).sort({ createdAt: -1 }),
  ]);

  if (!company) {
    return { allowed: false, code: "COMPANY_NOT_FOUND", message: "Company not found" };
  }

  if (company.isActive === false || company.status === "inactive") {
    return {
      company,
      subscription,
      allowed: false,
      code: "ACCOUNT_INACTIVE",
      message: "Your account is inactive. Please contact support.",
    };
  }

  const effectiveEndDate = subscription?.endDate || company.subscriptionExpiry;
  const status = subscription?.status || company.subscriptionStatus || "active";
  const daysLeft = getDaysLeft(effectiveEndDate);
  const isExpired = daysLeft !== null && daysLeft < 0;
  const isInactiveSubscription = ["expired", "cancelled"].includes(String(status || "").toLowerCase());

  if (isExpired || isInactiveSubscription) {
    if (subscription && subscription.status !== "expired" && isExpired) {
      subscription.status = "expired";
      await subscription.save();
    }
    if (company.subscriptionStatus !== "expired" && isExpired) {
      company.subscriptionStatus = "expired";
      await company.save();
    }
    return {
      company,
      subscription,
      allowed: false,
      code: "SUBSCRIPTION_EXPIRED",
      message: "Your subscription plan has expired. Please renew.",
      daysLeft,
    };
  }

  return {
    company,
    subscription,
    allowed: true,
    code: "OK",
    daysLeft,
    warning:
      daysLeft !== null && daysLeft <= 10
        ? {
            subscriptionWarning: true,
            daysLeft,
            message: `Your subscription will expire in ${daysLeft} days.`,
          }
        : null,
  };
};

const applySubscriptionToCompany = async (companyId, subscription) => {
  await Company.findByIdAndUpdate(companyId, {
    subscriptionExpiry: subscription.endDate,
    subscriptionStatus: subscription.status,
    subscriptionId: subscription._id,
    isActive: subscription.status !== "cancelled",
    status: subscription.status === "cancelled" ? "inactive" : "active",
  });
};

const getUsageForCompany = async (companyId) => {
  const [branches, users, invoicesThisMonth] = await Promise.all([
    Branch.countDocuments({ companyId, status: "active" }),
    User.countDocuments({ companyId, isActive: true }),
    SalesInvoice.countDocuments({
      companyId,
      createdAt: { $gte: startOfMonth(), $lt: endOfMonth() },
    }),
  ]);

  return { branches, users, invoicesThisMonth };
};

const limitError = (res) =>
  res.status(403).json({
    success: false,
    code: "LIMIT_EXCEEDED",
    message: "Your current plan limit has been reached.",
  });

const enforceLimit = async (req, res, next, limitName, currentCount) => {
  const state = await getSubscriptionState(req.user.companyId);
  const limit = Number(state.subscription?.[limitName] || 0);
  if (limit > 0 && currentCount >= limit) {
    return limitError(res);
  }
  return next();
};

module.exports = {
  addDuration,
  applySubscriptionToCompany,
  enforceLimit,
  getSubscriptionState,
  getUsageForCompany,
  limitError,
  startOfMonth,
  endOfMonth,
};
