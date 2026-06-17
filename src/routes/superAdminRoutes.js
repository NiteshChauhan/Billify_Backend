const express = require("express");
const router = express.Router();
const controller = require("../controllers/superAdminController");
const superAdminAuth = require("../middlewares/superAdminAuthMiddleware");

router.post("/auth/login", controller.login);

router.use(superAdminAuth);

router.get("/auth/profile", controller.profile);
router.get("/dashboard/stats", controller.dashboardStats);
router.get("/audit-logs", controller.auditLogs);

router.get("/admins", controller.listAdmins);
router.post("/admins", controller.createAdmin);
router.get("/admins/:id", controller.getAdmin);
router.put("/admins/:id", controller.updateAdmin);
router.patch("/admins/:id/status", controller.updateAdminStatus);
router.delete("/admins/:id", controller.deleteAdmin);

router.get("/admins/:adminId/subscription", controller.getAdminSubscription);
router.post("/admins/:adminId/subscription", controller.upsertAdminSubscription);
router.put("/admins/:adminId/subscription", controller.upsertAdminSubscription);
router.post("/admins/:adminId/subscription/renew", controller.renewAdminSubscription);
router.patch("/admins/:adminId/limits", controller.updateAdminLimits);

router.get("/admins/:adminId/overview", controller.adminOverview);
router.get("/admins/:adminId/branches", controller.listAdminBranches);
router.get("/admins/:adminId/users", controller.listAdminUsers);
router.get("/admins/:adminId/invoices", controller.listAdminInvoices);
router.get("/admins/:adminId/payments", controller.listAdminPayments);

module.exports = router;
