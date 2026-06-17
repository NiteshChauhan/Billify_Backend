const jwt = require("jsonwebtoken");
const SuperAdmin = require("../models/SuperAdmin");

module.exports = async (req, res, next) => {
  if (req.method === "OPTIONS") return next();

  const token = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.split(" ")[1]
    : null;

  if (!token) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== "SUPER_ADMIN" || !decoded.superAdminId) {
      return res.status(403).json({ success: false, message: "Super Admin access required" });
    }

    const superAdmin = await SuperAdmin.findById(decoded.superAdminId).select("-password");
    if (!superAdmin || superAdmin.isActive === false) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    req.superAdmin = superAdmin;
    next();
  } catch (err) {
    res.status(401).json({ success: false, message: "Invalid token" });
  }
};
