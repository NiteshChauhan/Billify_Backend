const express = require("express");
const cors = require("cors");
const connectDB = require("../src/lib/db");

const app = express();

/* ================= CORS ================= */
const allowedOrigins = (
  process.env.CORS_ORIGIN ||
  "http://localhost:5173,http://127.0.0.1:5173,https://vue-frontend-indol.vercel.app"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const isLocalDevOrigin = (origin = "") =>
  /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?$/i.test(
    origin,
  );

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (isLocalDevOrigin(origin)) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 204,
  }),
);
app.options(
  /.*/,
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (isLocalDevOrigin(origin)) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 204,
  }),
);

app.use(express.json());

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
app.use("/api/bank-accounts", require("../src/routes/bankAccountRoutes"));
app.use("/api/settings", require("../src/routes/settingsRoutes"));

/* ================= 404 ================= */
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

/* ================= ERROR ================= */
app.use((err, req, res, next) => {
  console.error("🔥 API Error:", err);
  res.status(500).json({
    error: err.message || "Internal Server Error",
  });
});

module.exports = app;
