const express = require("express");
const cors = require("cors");
const connectDB = require("../src/lib/db");

const app = express();

/* ================= CORS ================= */
const allowedOrigins = [
  process.env.FRONTEND_URL || "",
  process.env.CLIENT_URL || "",
  process.env.CORS_ORIGIN || "",
  process.env.ALLOWED_ORIGINS || "",
  "https://vue-frontend-indol.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3000",
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

const isVercelPreviewOrigin = (origin = "") => {
  try {
    return /\.vercel\.app$/i.test(new URL(origin).hostname);
  } catch (err) {
    return false;
  }
};

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (isLocalDevOrigin(origin)) return callback(null, true);
    if (normalizedAllowedOrigins.has(normalizeOrigin(origin))) return callback(null, true);
    if (process.env.ALLOW_VERCEL_PREVIEW === "true" && isVercelPreviewOrigin(origin)) {
      return callback(null, true);
    }
    if (process.env.NODE_ENV !== "production") return callback(null, true);
    return callback(new Error(`CORS blocked origin: ${origin}`));
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

const shouldDebugRequests =
  process.env.DEBUG_REQUESTS === "true" || process.env.DEBUG_AUTH_FLOW === "true";

app.use((req, res, next) => {
  if (shouldDebugRequests) {
    console.log("[REQ]", {
      method: req.method,
      path: req.path,
      origin: req.headers.origin || "",
      hasAuthorization: Boolean(req.headers.authorization),
      branchHeader: req.headers["x-branch-id"] || "",
      companyHeader: req.headers["x-company-id"] || "",
    });
  }
  next();
});

/* ================= DB INIT (🔥 REQUIRED) ================= */
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    next(err);
  }
});

/* ================= HEALTH ================= */
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "Billing SaaS API",
    env: process.env.NODE_ENV || "production",
  });
});

/* ================= ROUTES ================= */
app.use("/api/auth", require("../src/routes/authRoutes"));
app.use("/api/products", require("../src/routes/productRoutes"));
app.use("/api/users", require("../src/routes/partyRoutes"));
app.use("/api/parties", require("../src/routes/partyRoutes"));
app.use("/api/stock", require("../src/routes/stockRoutes"));
app.use("/api/opening-stock", require("../src/routes/openingStockRoutes"));
app.use("/api/purchase", require("../src/routes/purchaseRoutes"));
app.use("/api/sales", require("../src/routes/salesRoutes"));
app.use("/api/payments", require("../src/routes/paymentRoutes"));
app.use("/api/returns", require("../src/routes/returnRoutes"));
app.use("/api/reports", require("../src/routes/reportRoutes"));
app.use("/api/invoice-pdf", require("../src/routes/invoicePdfRoutes"));
app.use("/api/stock-ledger", require("../src/routes/stockLedgerRoutes"));
app.use("/api/profit", require("../src/routes/profitRoutes"));
app.use("/api/dashboard", require("../src/routes/dashboardRoutes"));
app.use("/api/company-balance", require("../src/routes/companyBalanceRoutes"));
app.use("/api/expenses", require("../src/routes/expenseRoutes"));
app.use("/api/loans", require("../src/routes/loanRoutes"));
app.use("/api/bank-accounts", require("../src/routes/bankAccountRoutes"));
app.use("/api/stock-transfers", require("../src/routes/stockTransferRoutes"));
app.use("/api/collection-transfers", require("../src/routes/collectionTransferRoutes"));
app.use("/api/settings", require("../src/routes/settingsRoutes"));
app.use("/api/branches", require("../src/routes/branchRoutes"));
app.use("/api/backup", require("../src/routes/backupRoutes"));
app.use("/api/logs", require("../src/routes/auditLogRoutes"));

/* ================= 404 ================= */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

/* ================= ERROR ================= */
app.use((err, req, res, next) => {
  console.error("🔥 API Error:", err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

module.exports = app;
