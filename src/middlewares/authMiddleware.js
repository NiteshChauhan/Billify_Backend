const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { getSelectedBranchForCompany } = require("../utils/branchContext");

module.exports = async (req, res, next) => {
  if (req.method === "OPTIONS") {
    return next();
  }

  const shouldDebugAuth =
    process.env.DEBUG_REQUESTS === "true" || process.env.DEBUG_AUTH_FLOW === "true";

  let token = null;

  // 1️⃣ Header token (normal API)
  if (req.headers.authorization?.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }

  // 2️⃣ Query token (PDF / Download)
  if (!token && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    if (shouldDebugAuth) {
      console.warn("[AUTH] Missing token", {
        method: req.method,
        path: req.path,
        origin: req.headers.origin || "",
        hasAuthorization: Boolean(req.headers.authorization),
        branchHeader: req.headers["x-branch-id"] || "",
      });
    }
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select("_id companyId role isActive");
    if (!user || user.isActive === false) {
      if (shouldDebugAuth) {
        console.warn("[AUTH] User missing or inactive", {
          userId: decoded.userId,
          path: req.path,
        });
      }
      return res.status(401).json({ message: "Unauthorized" });
    }

    const requestedBranchId =
      req.headers["x-branch-id"] ||
      req.query.branchId ||
      req.body?.branchId ||
      null;

    const { branches, selectedBranch, requestedValid } = await getSelectedBranchForCompany(
      user.companyId,
      requestedBranchId,
    );

    if (!requestedValid) {
      if (shouldDebugAuth) {
        console.warn("[AUTH] Invalid branch access", {
          userId: decoded.userId,
          requestedBranchId,
          path: req.path,
        });
      }
      return res.status(403).json({ message: "Unauthorized branch access" });
    }

    req.user = {
      userId: String(user._id),
      role: user.role,
      companyId: String(user.companyId),
      branchId: selectedBranch ? String(selectedBranch._id) : null,
      branches,
      selectedBranch,
    };
    next();
  } catch (err) {
    if (shouldDebugAuth) {
      console.warn("[AUTH] Token verification failed", {
        path: req.path,
        reason: err.message,
      });
    }
    return res.status(401).json({ message: "Invalid token" });
  }
};
