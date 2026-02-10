const express = require("express");
const cors = require("cors");
require("../src/lib/db"); // ✅ ensure DB initialized once

const app = express();

/* ================= CORS ================= */
app.use(
  cors({
    origin: true, // allow all origins
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

/* ================= BODY ================= */
app.use(express.json());

/* ================= HEALTH ================= */
app.get("/api", (req, res) => {
  res.status(200).json({ message: "Billing SaaS API Running" });
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

/* ================= SAFE 404 ================= */
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

/* ================= ERROR HANDLER ================= */
app.use((err, req, res, next) => {
  console.error("🔥 API Error:", err);
  res.status(500).json({
    error: "Internal Server Error",
    message: err.message,
  });
});

module.exports = app;
