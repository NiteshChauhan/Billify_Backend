const express = require("express");
const cors = require("cors");

const app = express();

const allowedOrigins = [
  process.env.CLIENT_URL || "",
  process.env.CORS_ORIGIN || "",
  process.env.ALLOWED_ORIGINS || "",
  "https://vue-frontend-indol.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://billifyadmin.vercel.app",
]
  .flatMap((value) => String(value || "").split(","))
  .map((origin) => origin.trim())
  .filter(Boolean);
const normalizeOrigin = (origin = "") => String(origin || "").replace(/\/$/, "").toLowerCase();
const normalizedAllowedOrigins = new Set(allowedOrigins.map((origin) => normalizeOrigin(origin)));

const isLocalDevOrigin = (origin = "") =>
  /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?$/i.test(
    origin,
  );

const isVercelPreviewOrigin = (origin = "") =>
  /^https:\/\/[a-z0-9-]+-[-a-z0-9]+\.vercel\.app$/i.test(String(origin || "").replace(/\/$/, ""));

const corsOptions = {
  origin(origin, callback) {
    // Allow non-browser clients (no Origin header)
    if (!origin) return callback(null, true);
    if (isLocalDevOrigin(origin)) return callback(null, true);
    if (normalizedAllowedOrigins.has(normalizeOrigin(origin))) return callback(null, true);
    if (process.env.ALLOW_VERCEL_PREVIEW === "true" && isVercelPreviewOrigin(origin)) {
      return callback(null, true);
    }
    if (process.env.NODE_ENV !== "production") return callback(null, true);
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Branch-Id",
    "X-Company-Id",
    "X-Requested-With",
    "Accept",
    "Cache-Control",
    "Pragma",
    "Expires",
  ],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Billing SaaS API Running");
});

const authRoutes = require("./routes/authRoutes");
app.use("/api/auth", authRoutes);

const superAdminRoutes = require("./routes/superAdminRoutes");
const subscriptionPlanRoutes = require("./routes/superAdmin/subscriptionPlan.routes");
app.use("/api/super-admin/plans", subscriptionPlanRoutes);
app.use("/api/super-admin", superAdminRoutes);

const adminUnitRoutes = require("./routes/adminUnitRoutes");
app.use("/api/admin/units", adminUnitRoutes);

const adminApplicatorRoutes = require("./routes/adminApplicatorRoutes");
app.use("/api/admin/applicators", adminApplicatorRoutes);

const adminSiteRoutes = require("./routes/adminSiteRoutes");
app.use("/api/admin/sites", adminSiteRoutes);

const adminPartySiteApplicatorRoutes = require("./routes/adminPartySiteApplicatorRoutes");
app.use("/api/admin/party-site-applicators", adminPartySiteApplicatorRoutes);

const adminApplicatorReportRoutes = require("./routes/adminApplicatorReportRoutes");
app.use("/api/admin", adminApplicatorReportRoutes);

const productRoutes = require("./routes/productRoutes");
app.use("/api/products", productRoutes);

const partyRoutes = require("./routes/partyRoutes");
app.use("/api/users", partyRoutes);
app.use("/api/parties", partyRoutes);

const stockRoutes = require("./routes/stockRoutes");
app.use("/api/stock", stockRoutes);

const openingStockRoutes = require("./routes/openingStockRoutes");
app.use("/api/opening-stock", openingStockRoutes);

const purchaseRoutes = require("./routes/purchaseRoutes");
app.use("/api/purchase", purchaseRoutes);

const salesRoutes = require("./routes/salesRoutes");
app.use("/api/sales", salesRoutes);

const paymentRoutes = require("./routes/paymentRoutes");
app.use("/api/payments", paymentRoutes);

const returnRoutes = require("./routes/returnRoutes");
app.use("/api/returns", returnRoutes);

const reportRoutes = require("./routes/reportRoutes");
app.use("/api/reports", reportRoutes);

const invoicePdfRoutes = require("./routes/invoicePdfRoutes");
app.use("/api/invoice-pdf", invoicePdfRoutes);

const stockLedgerRoutes = require("./routes/stockLedgerRoutes");
app.use("/api/stock-ledger", stockLedgerRoutes);

const profitRoutes = require("./routes/profitRoutes");
app.use("/api/profit", profitRoutes);

const dashboardRoutes = require("./routes/dashboardRoutes");
app.use("/api/dashboard", dashboardRoutes);

const companyBalanceRoutes = require("./routes/companyBalanceRoutes");
app.use("/api/company-balance", companyBalanceRoutes);

const expenseRoutes = require("./routes/expenseRoutes");
app.use("/api/expenses", expenseRoutes);

const loanRoutes = require("./routes/loanRoutes");
app.use("/api/loans", loanRoutes);

const bankAccountRoutes = require("./routes/bankAccountRoutes");
app.use("/api/bank-accounts", bankAccountRoutes);

const stockTransferRoutes = require("./routes/stockTransferRoutes");
app.use("/api/stock-transfers", stockTransferRoutes);

const collectionTransferRoutes = require("./routes/collectionTransferRoutes");
app.use("/api/collection-transfers", collectionTransferRoutes);

const settingsRoutes = require("./routes/settingsRoutes");
app.use("/api/settings", settingsRoutes);

const branchRoutes = require("./routes/branchRoutes");
app.use("/api/branches", branchRoutes);

const backupRoutes = require("./routes/backupRoutes");
app.use("/api/backup", backupRoutes);

const auditLogRoutes = require("./routes/auditLogRoutes");
app.use("/api/logs", auditLogRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

app.use((err, req, res, next) => {
  console.error("API Error:", err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

module.exports = app;
