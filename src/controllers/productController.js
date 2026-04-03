const Product = require("../models/Product");
const StockLedger = require("../models/StockLedger");
const PurchaseInvoice = require("../models/PurchaseInvoice");
const SalesInvoice = require("../models/SalesInvoice");
const ReturnEntry = require("../models/Return");
const Party = require("../models/Party");

/* ================= CREATE PRODUCT ================= */
exports.createProduct = async (req, res) => {
  try {
    const { name, sku, openingStock = 0, openingRate = 0, price = 0 } = req.body;

    if (!name || !sku) {
      return res.status(400).json({
        message: "Product name and SKU are required"
      });
    }

    /* ✅ SAVE FULL BODY (attributes, unit, gst, etc.) */
    const product = await Product.create({
      companyId: req.user.companyId,
      ...req.body,
      price: Number(price || 0),
      openingStock: Number(openingStock || 0),
      openingRate: Number(openingRate || 0),
      lastPurchaseRate: Number(req.body.lastPurchaseRate || openingRate || 0),
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
        price: Number(req.body.price ?? existing.price ?? 0),
        openingStock: incomingOpeningStock,
        openingRate: incomingOpeningRate,
        lastPurchaseRate: Number(req.body.lastPurchaseRate ?? existing.lastPurchaseRate ?? incomingOpeningRate),
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

exports.getLastRate = async (req, res) => {
  try {
    const { id: productId } = req.params;
    const { partyId, type } = req.query;

    if (!partyId) {
      return res.status(400).json({ message: "partyId is required" });
    }

    const normalizedType = String(type || "").toLowerCase();
    if (!["sale", "purchase"].includes(normalizedType)) {
      return res.status(400).json({ message: "type must be sale or purchase" });
    }

    const InvoiceModel = normalizedType === "sale" ? SalesInvoice : PurchaseInvoice;
    const invoice = await InvoiceModel.findOne({
      companyId: req.user.companyId,
      partyId,
      "items.productId": productId,
    })
      .sort({ invoiceDate: -1, createdAt: -1 })
      .select("items invoiceDate");

    const line = (invoice?.items || []).find((item) => String(item.productId) === String(productId));
    res.json({
      productId,
      lastRate: line ? Number(line.rate || 0) : null,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to load last rate", error: err.message });
  }
};

exports.downloadSampleCsv = async (req, res) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="products-sample.csv"');
  res.send("name,stock,price\nProduct A,10,100\nProduct B,5,200\n");
};

exports.bulkUploadProducts = async (req, res) => {
  try {
    const csvText = String(req.body.csvText || "").trim();
    if (!csvText) {
      return res.status(400).json({ message: "csvText is required" });
    }

    const lines = csvText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length < 2) {
      return res.status(400).json({ message: "CSV must include header and at least one row" });
    }

    const header = lines[0].split(",").map((value) => value.trim().toLowerCase());
    const nameIndex = header.indexOf("name");
    const stockIndex = header.indexOf("stock");
    const priceIndex = header.indexOf("price");

    if (nameIndex === -1 || stockIndex === -1 || priceIndex === -1) {
      return res.status(400).json({ message: "CSV header must be name,stock,price" });
    }

    let insertedCount = 0;
    let skippedCount = 0;
    const errors = [];

    for (let index = 1; index < lines.length; index += 1) {
      const values = lines[index].split(",").map((value) => value.trim());
      const name = values[nameIndex] || "";
      const stock = Number(values[stockIndex] || 0);
      const price = Number(values[priceIndex] || 0);
      const rowNumber = index + 1;

      if (!name) {
        errors.push({ row: rowNumber, message: "name is required" });
        continue;
      }
      if (Number.isNaN(stock) || Number.isNaN(price)) {
        errors.push({ row: rowNumber, message: "stock and price must be numeric" });
        continue;
      }

      const existing = await Product.findOne({
        companyId: req.user.companyId,
        name,
      }).select("_id");

      if (existing) {
        skippedCount += 1;
        continue;
      }

      const product = await Product.create({
        companyId: req.user.companyId,
        name,
        sku: `CSV-${Date.now()}-${index}`,
        price,
        openingStock: stock,
        openingRate: price,
        lastPurchaseRate: price,
      });

      if (stock > 0) {
        await StockLedger.create({
          companyId: req.user.companyId,
          productId: product._id,
          type: "OPENING",
          quantity: stock,
          rate: price,
          referenceType: "OPENING_STOCK",
          referenceId: product._id,
        });
      }

      insertedCount += 1;
    }

    res.json({
      insertedCount,
      skippedCount,
      errorCount: errors.length,
      errors,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to bulk upload products", error: err.message });
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
