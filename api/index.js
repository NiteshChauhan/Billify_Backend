const express = require("express");
const cors = require("cors");
const connectDB = require("../src/lib/db");

const app = express();

/* ================= CORS ================= */
app.use(
  cors({
    origin: ["http://localhost:5173", "https://vue-frontend-indol.vercel.app"],
    credentials: true,
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
app.use("/api/suppliers", require("../src/routes/supplierRoutes"));
app.use("/api/vendors", require("../src/routes/vendorRoutes"));
app.use("/api/stock", require("../src/routes/stockRoutes"));
app.use("/api/opening-stock", require("../src/routes/openingStockRoutes"));
app.use("/api/purchase", require("../src/routes/purchaseRoutes"));
app.use("/api/sales", require("../src/routes/salesRoutes"));
app.use("/api/payments", require("../src/routes/paymentRoutes"));
app.use("/api/reports", require("../src/routes/reportRoutes"));
app.use("/api/invoice-pdf", require("../src/routes/invoicePdfRoutes"));
app.use("/api/stock-ledger", require("../src/routes/stockLedgerRoutes"));
app.use("/api/supplier-ledger", require("../src/routes/supplierLedgerRoutes"));
app.use("/api/profit", require("../src/routes/profitRoutes"));
app.use("/api/dashboard", require("../src/routes/dashboardRoutes"));

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
