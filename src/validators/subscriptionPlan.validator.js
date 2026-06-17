const SubscriptionPlan = require("../models/SubscriptionPlan");

const normalizeCode = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");

const normalizeFeatures = (features) => {
  if (!features) return [];
  if (!Array.isArray(features)) return [String(features).trim()].filter(Boolean);
  return features.map((feature) => String(feature || "").trim()).filter(Boolean);
};

const toNumber = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  const next = Number(value);
  return Number.isFinite(next) ? next : Number.NaN;
};

const buildPlanPayload = (body = {}, existing = null, superAdminId = null, isCreate = false) => ({
  name: body.name !== undefined ? String(body.name || "").trim() : existing?.name,
  code: body.code !== undefined ? normalizeCode(body.code) : existing?.code,
  description: body.description !== undefined ? String(body.description || "").trim() : existing?.description || "",
  price: toNumber(body.price, existing?.price ?? 0),
  currency: body.currency !== undefined ? String(body.currency || "INR").trim().toUpperCase() : existing?.currency || "INR",
  durationType: body.durationType !== undefined ? String(body.durationType || "months").trim() : existing?.durationType || "months",
  durationValue: toNumber(body.durationValue, existing?.durationValue ?? 1),
  maxBranches: toNumber(body.maxBranches, existing?.maxBranches ?? 1),
  maxUsers: toNumber(body.maxUsers, existing?.maxUsers ?? 5),
  maxInvoicesPerMonth: toNumber(body.maxInvoicesPerMonth, existing?.maxInvoicesPerMonth ?? 100),
  features: body.features !== undefined ? normalizeFeatures(body.features) : existing?.features || [],
  isTrial: body.isTrial !== undefined ? Boolean(body.isTrial) : Boolean(existing?.isTrial),
  isActive: body.isActive !== undefined ? Boolean(body.isActive) : existing?.isActive !== false,
  sortOrder: toNumber(body.sortOrder, existing?.sortOrder ?? 0),
  ...(isCreate ? { createdBy: superAdminId } : {}),
  updatedBy: superAdminId,
});

const validatePlanPayload = (payload) => {
  const errors = [];
  if (!payload.name || payload.name.length < 2) errors.push("name must be at least 2 characters");
  if (!payload.code) errors.push("code is required");
  if (!Number.isFinite(payload.price) || payload.price < 0) errors.push("price must be greater than or equal to 0");
  if (!["days", "months", "years"].includes(payload.durationType)) errors.push("durationType is invalid");
  if (!Number.isFinite(payload.durationValue) || payload.durationValue <= 0) errors.push("durationValue must be greater than 0");
  if (!Number.isFinite(payload.maxBranches) || payload.maxBranches < 1) errors.push("maxBranches must be greater than or equal to 1");
  if (!Number.isFinite(payload.maxUsers) || payload.maxUsers < 1) errors.push("maxUsers must be greater than or equal to 1");
  if (!Number.isFinite(payload.maxInvoicesPerMonth) || payload.maxInvoicesPerMonth < 1) {
    errors.push("maxInvoicesPerMonth must be greater than or equal to 1");
  }
  return errors;
};

const validateUniquePlan = async ({ code, name, excludeId = null }) => {
  const query = {
    isDeleted: false,
    $or: [{ code }, { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }],
  };
  if (excludeId) query._id = { $ne: excludeId };

  const existing = await SubscriptionPlan.findOne(query).select("_id code name");
  if (!existing) return null;
  if (existing.code === code) return "Plan code already exists";
  return "Plan name already exists";
};

module.exports = {
  buildPlanPayload,
  normalizeCode,
  validatePlanPayload,
  validateUniquePlan,
};
