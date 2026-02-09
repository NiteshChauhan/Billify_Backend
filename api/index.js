const express = require("express");
const cors = require("cors");
const connectDB = require("../src/db");

const app = express();

/* ---------------- MIDDLEWARES ---------------- */
app.use(cors());
app.use(express.json());

/* ---------------- DB CONNECTION ---------------- */
connectDB()
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.error("MongoDB Error:", err));

/* ---------------- HEALTH CHECK ---------------- */
app.get("/", (req, res) => {
  res.send("Billing SaaS API Running");
});

/* ---------------- ROUTES ---------------- */
const authRoutes = require("../src/routes/authRoutes");
app.use("/api/auth", authRoutes);

const productRoutes = require("../src/routes/productRoutes");
app.use("/api/products", productRoutes);

const supplierRoutes = require("../src/routes/supplierRoutes");
app.use("/api/suppliers", supplierRoutes);

const vendorRoutes = require("../src/routes/vendorRoutes");
app.use("/api/vendors", vendorRoutes);

const stockRoutes = require("../src/routes/stockRoutes");
app.use("/api/stock", stockRoutes);

const openingStockRoutes = require("../src/routes/openingStockRoutes");
app.use("/api/opening-stock", openingStockRoutes);

const purchaseRoutes = require("../src/routes/purchaseRoutes");
app.use("/api/purchase", purchaseRoutes);

const salesRoutes = require("../src/routes/salesRoutes");
app.use("/api/sales", salesRoutes);

const paymentRoutes = require("../src/routes/paymentRoutes");
app.use("/api/payments", paymentRoutes);

const reportRoutes = require("../src/routes/reportRoutes");
app.use("/api/reports", reportRoutes);

const invoicePdfRoutes = require("../src/routes/invoicePdfRoutes");
app.use("/api/invoice-pdf", invoicePdfRoutes);

const stockLedgerRoutes = require("../src/routes/stockLedgerRoutes");
app.use("/api/stock-ledger", stockLedgerRoutes);

const supplierLedgerRoutes = require("../src/routes/supplierLedgerRoutes");
app.use("/api/supplier-ledger", supplierLedgerRoutes);

const profitRoutes = require("../src/routes/profitRoutes");
app.use("/api/profit", profitRoutes);

const dashboardRoutes = require("../src/routes/dashboardRoutes");
app.use("/api/dashboard", dashboardRoutes);

module.exports = app;
