const mongoose = require("mongoose");
const SubscriptionPlan = require("../../models/SubscriptionPlan");
const { errorResponse, successResponse } = require("../../utils/apiResponse");
const {
  buildPlanPayload,
  validatePlanPayload,
  validateUniquePlan,
} = require("../../validators/subscriptionPlan.validator");

const buildPagination = (query) => {
  const page = Math.max(1, Number(query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(query.limit || 10)));
  return { page, limit, skip: (page - 1) * limit };
};

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(String(id || ""));

exports.createPlan = async (req, res) => {
  try {
    const payload = buildPlanPayload(req.body, null, req.superAdmin?._id, true);
    const errors = validatePlanPayload(payload);
    if (errors.length) return errorResponse(res, 400, errors[0], "VALIDATION_ERROR");

    const duplicateMessage = await validateUniquePlan(payload);
    if (duplicateMessage) return errorResponse(res, 409, duplicateMessage, "DUPLICATE_PLAN");

    const plan = await SubscriptionPlan.create(payload);
    return successResponse(res, 201, "Subscription plan created successfully", plan);
  } catch (err) {
    if (err.code === 11000) {
      return errorResponse(res, 409, "Plan code already exists", "DUPLICATE_PLAN");
    }
    return errorResponse(res, 500, "Failed to create subscription plan");
  }
};

exports.getPlans = async (req, res) => {
  try {
    const { page, limit, skip } = buildPagination(req.query);
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim().toLowerCase();
    const query = { isDeleted: false };

    if (status === "active") query.isActive = true;
    if (status === "inactive") query.isActive = false;
    if (search) {
      query.$or = [
        { name: new RegExp(search, "i") },
        { code: new RegExp(search, "i") },
      ];
    }

    const [plans, total] = await Promise.all([
      SubscriptionPlan.find(query).sort({ sortOrder: 1, createdAt: -1 }).skip(skip).limit(limit),
      SubscriptionPlan.countDocuments(query),
    ]);

    return successResponse(res, 200, "Subscription plans loaded successfully", plans, {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    return errorResponse(res, 500, "Failed to load subscription plans");
  }
};

exports.getPlan = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return errorResponse(res, 400, "Invalid plan id", "INVALID_ID");
    }

    const plan = await SubscriptionPlan.findOne({ _id: req.params.id, isDeleted: false });
    if (!plan) return errorResponse(res, 404, "Subscription plan not found", "PLAN_NOT_FOUND");

    return successResponse(res, 200, "Subscription plan loaded successfully", plan);
  } catch (err) {
    return errorResponse(res, 500, "Failed to load subscription plan");
  }
};

exports.updatePlan = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return errorResponse(res, 400, "Invalid plan id", "INVALID_ID");
    }

    const existing = await SubscriptionPlan.findOne({ _id: req.params.id, isDeleted: false });
    if (!existing) return errorResponse(res, 404, "Subscription plan not found", "PLAN_NOT_FOUND");

    const payload = buildPlanPayload(req.body, existing, req.superAdmin?._id, false);
    const errors = validatePlanPayload(payload);
    if (errors.length) return errorResponse(res, 400, errors[0], "VALIDATION_ERROR");

    const duplicateMessage = await validateUniquePlan({
      ...payload,
      excludeId: existing._id,
    });
    if (duplicateMessage) return errorResponse(res, 409, duplicateMessage, "DUPLICATE_PLAN");

    Object.assign(existing, payload);
    await existing.save();

    return successResponse(res, 200, "Subscription plan updated successfully", existing);
  } catch (err) {
    if (err.code === 11000) {
      return errorResponse(res, 409, "Plan code already exists", "DUPLICATE_PLAN");
    }
    return errorResponse(res, 500, "Failed to update subscription plan");
  }
};

exports.changeStatus = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return errorResponse(res, 400, "Invalid plan id", "INVALID_ID");
    }

    if (req.body.isActive === undefined) {
      return errorResponse(res, 400, "isActive is required", "VALIDATION_ERROR");
    }

    const plan = await SubscriptionPlan.findOneAndUpdate(
      { _id: req.params.id, isDeleted: false },
      { isActive: Boolean(req.body.isActive), updatedBy: req.superAdmin?._id },
      { new: true },
    );
    if (!plan) return errorResponse(res, 404, "Subscription plan not found", "PLAN_NOT_FOUND");

    return successResponse(res, 200, "Subscription plan status updated successfully", plan);
  } catch (err) {
    return errorResponse(res, 500, "Failed to update subscription plan status");
  }
};

exports.deletePlan = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return errorResponse(res, 400, "Invalid plan id", "INVALID_ID");
    }

    const plan = await SubscriptionPlan.findOneAndUpdate(
      { _id: req.params.id, isDeleted: false },
      {
        isDeleted: true,
        isActive: false,
        deletedAt: new Date(),
        updatedBy: req.superAdmin?._id,
      },
      { new: true },
    );
    if (!plan) return errorResponse(res, 404, "Subscription plan not found", "PLAN_NOT_FOUND");

    return successResponse(res, 200, "Subscription plan deleted successfully", plan);
  } catch (err) {
    return errorResponse(res, 500, "Failed to delete subscription plan");
  }
};
