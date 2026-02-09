const express = require("express");
const cors = require("cors");

const app = express();

/* ================= CORS CONFIG ================= */
const corsOptions = {
  origin: [
    "http://localhost:3000",
    "http://localhost:5173",
    "https://vue-frontend-indol.vercel.app",
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

/* MUST be before routes */
app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // 🔥 VERY IMPORTANT
app.use(express.json());

/* ================= HEALTH CHECK ================= */
app.get("/", (req, res) => {
  res.send("Billing SaaS API Running");
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

/* ================= FALLBACK ================= */
app.use((err, req, res, next) => {
  console.error("Unhandled Error:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

module.exports = app;
