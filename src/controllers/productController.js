const Product = require("../models/Product");
const StockLedger = require("../models/StockLedger");
const PurchaseInvoice = require("../models/PurchaseInvoice");
const SalesInvoice = require("../models/SalesInvoice");
const ReturnEntry = require("../models/Return");
const Party = require("../models/Party");
const Unit = require("../models/Unit");
const mongoose = require("mongoose");
const { getAvailableStock } = require("../utils/stockUtils");
const { withBranchScope } = require("../utils/branchScope");
const {
  assertOpeningStockEditable,
  syncOpeningStock,
} = require("../utils/openingStockUtils");

const resolveUnitSnapshot = async (req, unitId) => {
  if (!unitId) return { unitId: null, unitName: "" };
  const unit = await Unit.findOne({
    _id: unitId,
    adminId: req.user.companyId,
    isActive: true,
    isDeleted: false,
  }).select("_id name shortName");
  if (!unit) {
    const err = new Error("Invalid unit");
    err.status = 400;
    throw err;
  }
  return { unitId: unit._id, unitName: unit.shortName || unit.name };
};

const buildProductStatusFilter = (status = "active") => {
  const normalized = String(status || "active").toLowerCase();
  if (normalized === "deleted") {
    return { statusFilter: { isDeleted: true }, withDeleted: true };
  }
  if (normalized === "all") {
    return { statusFilter: {}, withDeleted: true };
  }
  return { statusFilter: {}, withDeleted: false };
};

/* ================= CREATE PRODUCT ================= */
exports.createProduct = async (req, res) => {
  try {
    const { name, sku, openingStock = 0, openingRate = 0, price = 0 } = req.body;

    if (!name || !sku) {
      return res.status(400).json({
        message: "Product name and SKU are required"
      });
    }

    const unitSnapshot = await resolveUnitSnapshot(req, req.body.unitId);

    /* ✅ SAVE FULL BODY (attributes, unit, gst, etc.) */
    const product = await Product.create({
      companyId: req.user.companyId,
      branchId: req.user.branchId || null,
      ...req.body,
      ...unitSnapshot,
      price: Number(price || 0),
      openingStock: Number(openingStock || 0),
      openingRate: Number(openingRate || 0),
      lastPurchaseRate: Number(req.body.lastPurchaseRate || openingRate || 0),
      lastSalePrice: Number(req.body.lastSalePrice || price || 0),
    });

    await syncOpeningStock({
      companyId: req.user.companyId,
      branchId: req.user.branchId || null,
      productId: product._id,
      quantity: openingStock,
      rate: openingRate,
      syncProductFields: false,
      branchIsDefault: req.user.branchIsDefault,
    });

    res.json(product);
  } catch (err) {
    res.status(err.status || 500).json({
      message: "Failed to create product",
      error: err.message
    });
  }
};

/* ================= GET ALL PRODUCTS ================= */
exports.getProducts = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const branchScope = req.user.branchScope || req.user.branchId || null;
    const pageParam = Number(req.query.page || 0);
    const limitParam = Number(req.query.limit || 0);
    const isPaginated = pageParam > 0 || limitParam > 0;
    const page = pageParam > 0 ? pageParam : 1;
    const limit = limitParam > 0 ? Math.min(limitParam, 100) : 20;
    const { statusFilter, withDeleted } = buildProductStatusFilter(req.query.status);
    const filter = withBranchScope(
      { companyId, ...statusFilter },
      req.user.branchId,
      req.user.branchIsDefault,
    );

    const [products, total] = await Promise.all([
      Product.find(filter)
        .setOptions({ withDeleted })
        .sort({ createdAt: -1 })
        .skip(isPaginated ? (page - 1) * limit : 0)
        .limit(isPaginated ? limit : 0)
        .lean(),
      Product.countDocuments(filter).setOptions({ withDeleted }),
    ]);

    const productRows = await Promise.all(
      products.map(async (product) => {
        const currentStock = await getAvailableStock(
          companyId,
          req.user.branchId || null,
          product._id,
          new Date(),
          req.user.branchIsDefault,
        );
        return {
          ...product,
          stock: Number(currentStock || 0),
          inStock: Number(currentStock || 0),
          totalStock: Number(currentStock || 0),
          lastPurchasePrice: Number(product.lastPurchaseRate || 0),
          lastSalePrice: Number(product.lastSalePrice || 0),
        };
      }),
    );

    if (!isPaginated) {
      return res.json(productRows);
    }

    res.json({
      data: productRows,
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    res.status(500).json({
      message: "Failed to load products"
    });
  }
};

/* ================= GET SINGLE PRODUCT ================= */
exports.getProductById = async (req, res) => {
  try {
    const product = await Product.findOne(
      withBranchScope(
        {
          _id: req.params.id,
          companyId: req.user.companyId,
        },
        req.user.branchId,
        req.user.branchIsDefault,
      ),
    ).setOptions({ withDeleted: req.query.status === "deleted" || req.query.status === "all" });

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
    const existing = await Product.findOne(
      withBranchScope({ _id: productId, companyId }, req.user.branchId, req.user.branchIsDefault),
    );

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

    const openingChanged =
      Number(existing.openingStock || 0) !== incomingOpeningStock ||
      Number(existing.openingRate || 0) !== incomingOpeningRate;

    if (openingChanged) {
      await assertOpeningStockEditable(
        companyId,
        req.user.branchScope || req.user.branchId || null,
        productId,
        incomingOpeningStock,
        incomingOpeningRate,
        req.user.branchIsDefault,
      );
    }

    const unitSnapshot = await resolveUnitSnapshot(req, req.body.unitId);

    const updateData = {
      ...req.body,
      ...unitSnapshot,
      price: Number(req.body.price ?? existing.price ?? 0),
      lastPurchaseRate: Number(req.body.lastPurchaseRate ?? existing.lastPurchaseRate ?? incomingOpeningRate),
      lastSalePrice: Number(req.body.lastSalePrice ?? existing.lastSalePrice ?? existing.price ?? 0),
    };
    delete updateData.openingStock;
    delete updateData.openingRate;

    const product = await Product.findOneAndUpdate(
      withBranchScope({ _id: productId, companyId }, req.user.branchId, req.user.branchIsDefault),
      updateData,
      { new: true }
    );

    if (!product) {
      return res.status(404).json({
        message: "Product not found"
      });
    }

    await syncOpeningStock({
      companyId,
      branchId: req.user.branchId || null,
      productId,
      quantity: incomingOpeningStock,
      rate: incomingOpeningRate,
      branchIsDefault: req.user.branchIsDefault,
    });
    const updatedProduct = await Product.findOne(
      withBranchScope({ _id: productId, companyId }, req.user.branchId, req.user.branchIsDefault),
    );
    res.json(updatedProduct || product);
  } catch (err) {
    res.status(err.status || 500).json({
      message: "Failed to update product",
      error: err.message
    });
  }
};

/* ================= DELETE PRODUCT ================= */
exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findOne(
      withBranchScope(
        { _id: req.params.id, companyId: req.user.companyId },
        req.user.branchId,
        req.user.branchIsDefault,
      ),
    );

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const hasTransactions = await StockLedger.exists({
      companyId: req.user.companyId,
      productId: product._id,
      type: { $in: ["PURCHASE", "SALE", "PURCHASE_RETURN", "SALE_RETURN"] },
    });

    if (hasTransactions) {
      return res.status(400).json({
        message: "Product with transaction history cannot be deleted",
      });
    }

    product.isDeleted = true;
    product.deletedAt = new Date();
    product.deletedBy = req.user._id || null;
    await product.save();

    res.json({
      message: "Product deleted successfully"
    });
  } catch (err) {
    res.status(500).json({
      message: "Failed to delete product"
    });
  }
};

exports.restoreProduct = async (req, res) => {
  try {
    const product = await Product.findOne(
      withBranchScope(
        { _id: req.params.id, companyId: req.user.companyId, isDeleted: true },
        req.user.branchId,
        req.user.branchIsDefault,
      ),
    ).setOptions({ withDeleted: true });

    if (!product) {
      return res.status(404).json({ message: "Deleted product not found" });
    }

    product.isDeleted = false;
    product.deletedAt = null;
    product.deletedBy = null;
    await product.save();

    res.json({
      message: "Product restored successfully",
      product,
    });
  } catch (err) {
    res.status(500).json({
      message: "Failed to restore product",
      error: err.message,
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
    const invoice = await InvoiceModel.findOne(
      withBranchScope(
        {
          companyId: req.user.companyId,
          partyId,
          "items.productId": productId,
        },
        req.user.branchId,
        req.user.branchIsDefault,
      ),
    )
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

exports.getCapitalSummary = async (req, res) => {
  try {
    const companyId = new mongoose.Types.ObjectId(String(req.user.companyId));
    const branchScope = req.user.branchScope || req.user.branchId || null;
    const [productsCount, stockSummary] = await Promise.all([
      Product.countDocuments(
        withBranchScope({ companyId }, req.user.branchId, req.user.branchIsDefault),
      ),
      StockLedger.aggregate([
        { $match: withBranchScope({ companyId }, req.user.branchId, req.user.branchIsDefault) },
        {
          $group: {
            _id: "$productId",
            currentStock: {
              $sum: {
                $switch: {
                  branches: [
                    {
                      case: { $in: ["$type", ["OPENING", "PURCHASE", "SALE_RETURN"]] },
                      then: { $convert: { input: "$quantity", to: "double", onError: 0, onNull: 0 } },
                    },
                    {
                      case: { $in: ["$type", ["SALE", "PURCHASE_RETURN"]] },
                      then: {
                        $multiply: [
                          { $convert: { input: "$quantity", to: "double", onError: 0, onNull: 0 } },
                          -1,
                        ],
                      },
                    },
                  ],
                  default: 0,
                },
              },
            },
          },
        },
        {
          $lookup: {
            from: "products",
            localField: "_id",
            foreignField: "_id",
            as: "product",
          },
        },
        { $unwind: "$product" },
        { $match: { "product.isDeleted": false } },
        {
          $addFields: {
            stockNum: { $convert: { input: "$currentStock", to: "double", onError: 0, onNull: 0 } },
            priceNum: { $convert: { input: "$product.price", to: "double", onError: 0, onNull: 0 } },
          },
        },
        {
          $group: {
            _id: null,
            totalStockQty: { $sum: "$stockNum" },
            totalCapital: {
              $sum: { $multiply: ["$stockNum", "$priceNum"] },
            },
          },
        },
      ]),
    ]);

    const firstProduct = await Product.findOne(
      withBranchScope({ companyId }, req.user.branchId, req.user.branchIsDefault),
    ).select("name price openingStock").lean();
    if (process.env.NODE_ENV !== "production") {
      console.log("Capital summary debug:", firstProduct, {
        priceType: typeof firstProduct?.price,
        openingStockType: typeof firstProduct?.openingStock,
      });
    }

    res.json({
      totalProducts: productsCount,
      totalStockQty: Number(stockSummary[0]?.totalStockQty || 0),
      totalCapital: Number(stockSummary[0]?.totalCapital || 0),
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to load capital summary", error: err.message });
  }
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
    const skipped = [];
    const errors = [];

    for (let index = 1; index < lines.length; index += 1) {
      const values = lines[index].split(",").map((value) => value.trim());
      const name = values[nameIndex] || "";
      const stock = Number(values[stockIndex] || 0);
      const price = Number(values[priceIndex] || 0);

      if (!name) {
        skipped.push({ name: `Row ${index + 1}`, reason: "missing required field: name" });
        continue;
      }
      if (Number.isNaN(stock) || Number.isNaN(price)) {
        errors.push({ name, error: "invalid number in stock or price" });
        continue;
      }

      const existing = await Product.findOne({
        ...withBranchScope({ companyId: req.user.companyId }, req.user.branchId, req.user.branchIsDefault),
        name,
      }).select("_id");

      if (existing) {
        skipped.push({ name, reason: "duplicate product name" });
        continue;
      }

      try {
        const product = await Product.create({
          companyId: req.user.companyId,
          branchId: req.user.branchId || null,
          name,
          sku: `CSV-${Date.now()}-${index}`,
          price,
          openingStock: stock,
          openingRate: price,
          lastPurchaseRate: price,
          lastSalePrice: price,
        });

        await syncOpeningStock({
          companyId: req.user.companyId,
          branchId: req.user.branchId || null,
          productId: product._id,
          quantity: stock,
          rate: price,
          syncProductFields: false,
          branchIsDefault: req.user.branchIsDefault,
        });

        insertedCount += 1;
      } catch (error) {
        errors.push({ name, error: error.message || "DB error" });
      }
    }

    res.json({
      insertedCount,
      skippedCount: skipped.length,
      errorCount: errors.length,
      skipped,
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

    const product = await Product.findOne(
      withBranchScope({ _id: productId, companyId }, req.user.branchId, req.user.branchIsDefault),
    );
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const ledger = await StockLedger.find(
      withBranchScope({ companyId, productId }, req.user.branchId, req.user.branchIsDefault),
    ).sort({ createdAt: 1 }).lean();
    const referenceIds = [...new Set(ledger.map((row) => String(row.referenceId)).filter(Boolean))];

    const [sales, purchases, returns] = await Promise.all([
      SalesInvoice.find(withBranchScope({ companyId, _id: { $in: referenceIds } }, req.user.branchId, req.user.branchIsDefault)).select("_id invoiceNo partyId"),
      PurchaseInvoice.find(withBranchScope({ companyId, _id: { $in: referenceIds } }, req.user.branchId, req.user.branchIsDefault)).select("_id invoiceNo partyId"),
      ReturnEntry.find(withBranchScope({ companyId, billId: { $in: referenceIds } }, req.user.branchId, req.user.branchIsDefault)).select("billId returnType partyId"),
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

    const currentStock = await getAvailableStock(
      companyId,
      req.user.branchId || null,
      productId,
      new Date(),
      req.user.branchIsDefault,
    );

    res.json({
      product,
      summary: {
        openingStock: opening,
        openingRate,
        totalPurchase,
        totalSale,
        totalInStock: Number(currentStock || 0),
      },
      rows,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to load product history", error: err.message });
  }
};
