const Product = require("../models/Product");
const StockLedger = require("../models/StockLedger");
const PurchaseInvoice = require("../models/PurchaseInvoice");
const SalesInvoice = require("../models/SalesInvoice");
const ReturnEntry = require("../models/Return");
const Party = require("../models/Party");

/* ================= CREATE PRODUCT ================= */
exports.createProduct = async (req, res) => {
  try {
    const { name, sku, openingStock = 0, openingRate = 0 } = req.body;

    if (!name || !sku) {
      return res.status(400).json({
        message: "Product name and SKU are required"
      });
    }

    /* ✅ SAVE FULL BODY (attributes, unit, gst, etc.) */
    const product = await Product.create({
      companyId: req.user.companyId,
      ...req.body,
      openingStock: Number(openingStock || 0),
      openingRate: Number(openingRate || 0),
    });

    if (Number(openingStock || 0) > 0) {
      await StockLedger.create({
        companyId: req.user.companyId,
        productId: product._id,
        type: "OPENING",
        quantity: Number(openingStock || 0),
        rate: Number(openingRate || 0),
        referenceType: "OPENING_STOCK",
        referenceId: product._id,
      });
    }

    res.json(product);
  } catch (err) {
    res.status(500).json({
      message: "Failed to create product",
      error: err.message
    });
  }
};

/* ================= GET ALL PRODUCTS ================= */
exports.getProducts = async (req, res) => {
  try {
    const products = await Product.find({
      companyId: req.user.companyId
    }).sort({ createdAt: -1 });

    res.json(products);
  } catch (err) {
    res.status(500).json({
      message: "Failed to load products"
    });
  }
};

/* ================= GET SINGLE PRODUCT ================= */
exports.getProductById = async (req, res) => {
  try {
    const product = await Product.findOne({
      _id: req.params.id,
      companyId: req.user.companyId
    });

    if (!product) {
      return res.status(404).json({
        message: "Product not found"
      });
    }

    res.json(product);
  } catch (err) {
    res.status(500).json({
      message: "Failed to load product"
    });
  }
};

/* ================= UPDATE PRODUCT ================= */
exports.updateProduct = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const productId = req.params.id;
    const existing = await Product.findOne({ _id: productId, companyId });

    if (!existing) {
      return res.status(404).json({
        message: "Product not found"
      });
    }

    const incomingOpeningStock = Number(
      req.body.openingStock ?? existing.openingStock ?? 0,
    );
    const incomingOpeningRate = Number(
      req.body.openingRate ?? existing.openingRate ?? 0,
    );

    const openingEntry = await StockLedger.findOne({
      companyId,
      productId,
      type: "OPENING",
    });

    const hasTransactions = await StockLedger.exists({
      companyId,
      productId,
      type: { $in: ["PURCHASE", "SALE", "PURCHASE_RETURN", "SALE_RETURN"] },
    });

    const openingChanged =
      Number(existing.openingStock || 0) !== incomingOpeningStock ||
      Number(existing.openingRate || 0) !== incomingOpeningRate;

    if (openingChanged && hasTransactions) {
      return res.status(400).json({
        message: "Opening stock/rate cannot be changed after transactions exist",
      });
    }

    const product = await Product.findOneAndUpdate(
      { _id: productId, companyId },
      {
        ...req.body,
        openingStock: incomingOpeningStock,
        openingRate: incomingOpeningRate,
      },
      { new: true }
    );

    if (!product) {
      return res.status(404).json({
        message: "Product not found"
      });
    }

    if (!openingEntry && incomingOpeningStock > 0) {
      await StockLedger.create({
        companyId,
        productId,
        type: "OPENING",
        quantity: incomingOpeningStock,
        rate: incomingOpeningRate,
        referenceType: "OPENING_STOCK",
        referenceId: productId,
      });
    } else if (openingEntry && openingChanged) {
      openingEntry.quantity = incomingOpeningStock;
      openingEntry.rate = incomingOpeningRate;
      await openingEntry.save();
    }

    res.json(product);
  } catch (err) {
    res.status(500).json({
      message: "Failed to update product",
      error: err.message
    });
  }
};

/* ================= DELETE PRODUCT ================= */
exports.deleteProduct = async (req, res) => {
  try {
    await Product.findOneAndDelete({
      _id: req.params.id,
      companyId: req.user.companyId
    });

    res.json({
      message: "Product deleted successfully"
    });
  } catch (err) {
    res.status(500).json({
      message: "Failed to delete product"
    });
  }
};

exports.getProductHistory = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const productId = req.params.id;

    const product = await Product.findOne({ _id: productId, companyId });
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const ledger = await StockLedger.find({ companyId, productId }).sort({ createdAt: 1 }).lean();
    const referenceIds = [...new Set(ledger.map((row) => String(row.referenceId)).filter(Boolean))];

    const [sales, purchases, returns] = await Promise.all([
      SalesInvoice.find({ companyId, _id: { $in: referenceIds } }).select("_id invoiceNo partyId"),
      PurchaseInvoice.find({ companyId, _id: { $in: referenceIds } }).select("_id invoiceNo partyId"),
      ReturnEntry.find({ companyId, billId: { $in: referenceIds } }).select("billId returnType partyId"),
    ]);

    const partyIds = [
      ...new Set(
        [...sales, ...purchases, ...returns]
          .map((row) => (row.partyId ? String(row.partyId) : ""))
          .filter(Boolean),
      ),
    ];
    const parties = await Party.find({ _id: { $in: partyIds } }).select("_id name");

    const partyMap = Object.fromEntries(parties.map((p) => [String(p._id), p.name]));
    const saleMap = Object.fromEntries(
      sales.map((row) => [
        String(row._id),
        { invoiceNo: row.invoiceNo, partyName: partyMap[String(row.partyId)] || "-" },
      ]),
    );
    const purchaseMap = Object.fromEntries(
      purchases.map((row) => [
        String(row._id),
        { invoiceNo: row.invoiceNo, partyName: partyMap[String(row.partyId)] || "-" },
      ]),
    );
    const returnMap = Object.fromEntries(
      returns.map((row) => [
        String(row.billId),
        { returnType: row.returnType, partyName: partyMap[String(row.partyId)] || "-" },
      ]),
    );

    let running = 0;
    let opening = 0;
    let openingRate = Number(product.openingRate || 0);
    let totalPurchase = 0;
    let totalSale = 0;

    const rows = ledger.map((row) => {
      const inQty = ["OPENING", "PURCHASE", "SALE_RETURN"].includes(row.type) ? Number(row.quantity || 0) : 0;
      const outQty = ["SALE", "PURCHASE_RETURN"].includes(row.type) ? Number(row.quantity || 0) : 0;
      running += inQty - outQty;

      if (row.type === "OPENING") opening += inQty;
      if (row.type === "OPENING" && Number(row.rate || 0) >= 0) openingRate = Number(row.rate || 0);
      if (row.type === "PURCHASE") totalPurchase += inQty;
      if (row.type === "SALE") totalSale += outQty;

      const refId = String(row.referenceId || "");
      const baseSale = saleMap[refId];
      const basePurchase = purchaseMap[refId];
      const baseReturn = returnMap[refId];

      return {
        date: row.createdAt,
        type: row.type,
        quantityDr: inQty,
        quantityCr: outQty,
        price: Number(row.rate || 0),
        billNumber: baseSale?.invoiceNo || basePurchase?.invoiceNo || "-",
        partyName: baseSale?.partyName || basePurchase?.partyName || baseReturn?.partyName || "-",
        remainingStock: running,
        referenceType: row.referenceType,
        referenceId: row.referenceId,
      };
    });

    res.json({
      product,
      summary: {
        openingStock: opening,
        openingRate,
        totalPurchase,
        totalSale,
        totalInStock: running,
      },
      rows,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to load product history", error: err.message });
  }
};
