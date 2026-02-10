const express = require("express");
const cors = require("cors");
require("../src/lib/db"); // DB init once

const app = express();

/* ================= CORS ================= */
app.use(
  cors({
    origin: ["http://localhost:5173", "https://vue-frontend-indol.vercel.app"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

/* ================= BODY ================= */
app.use(express.json());

/* ================= HEALTH ================= */
app.get("/", (req, res) => {
  res.status(200).json({ message: "Billing SaaS API Running" });
});

/* ================= ROUTES ================= */
app.use("/auth", require("../src/routes/authRoutes"));
app.use("/products", require("../src/routes/productRoutes"));
app.use("/suppliers", require("../src/routes/supplierRoutes"));
app.use("/vendors", require("../src/routes/vendorRoutes"));
app.use("/stock", require("../src/routes/stockRoutes"));
app.use("/opening-stock", require("../src/routes/openingStockRoutes"));
app.use("/purchase", require("../src/routes/purchaseRoutes"));
app.use("/sales", require("../src/routes/salesRoutes"));
app.use("/payments", require("../src/routes/paymentRoutes"));
app.use("/reports", require("../src/routes/reportRoutes"));
app.use("/invoice-pdf", require("../src/routes/invoicePdfRoutes"));
app.use("/stock-ledger", require("../src/routes/stockLedgerRoutes"));
app.use("/supplier-ledger", require("../src/routes/supplierLedgerRoutes"));
app.use("/profit", require("../src/routes/profitRoutes"));
app.use("/dashboard", require("../src/routes/dashboardRoutes"));

/* ================= 404 ================= */
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

/* ================= ERROR ================= */
app.use((err, req, res, next) => {
  console.error("🔥 API Error:", err);
  res.status(500).json({
    error: "Internal Server Error",
    message: err.message,
  });
});

module.exports = app;
