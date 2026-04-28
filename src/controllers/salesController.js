const SalesInvoice = require("../models/SalesInvoice");
const StockLedger = require("../models/StockLedger");
const Party = require("../models/Party");
const Payment = require("../models/Payment");
const BankAccount = require("../models/BankAccount");
const Product = require("../models/Product");
const ReturnEntry = require("../models/Return");
const { validateStockForSale } = require("../utils/stockValidation");
const {
  consumeBatches,
  ensureLegacyBatch,
  restoreBatchesFromBreakdown,
  restoreByAverageCost,
} = require("../utils/stockUtils");
const { getDateRangeFromQuery } = require("../utils/dateRange");
const { withBranchScope } = require("../utils/branchScope");

const toSalesResponse = (invoiceDoc) => {
  const invoice = invoiceDoc.toObject ? invoiceDoc.toObject() : invoiceDoc;
  return {
    ...invoice,
    vendorId: invoice.partyId,
    customerId: invoice.partyId,
  };
};

const getProductPacking = (product) => {
  if (!product?.attributes || typeof product.attributes !== "object") {
    return "-";
  }
  return (
    product.attributes.packing ||
    product.attributes.Packing ||
    product.attributes.unit ||
    product.attributes.Unit ||
    product.attributes.size ||
    product.attributes.Size ||
    "-"
  );
};

const loadSaleProducts = async (companyId, items = []) => {
  const productIds = [
    ...new Set((items || []).map((item) => String(item.productId || "")).filter(Boolean)),
  ];
  const products = await Product.find({
    _id: { $in: productIds },
    companyId,
  }).select("name nameAr nameHi sku attributes");

  return new Map(products.map((product) => [String(product._id), product]));
};

const applyInvoiceItemSnapshot = (item, product) => {
  item.productName = product?.name || item.productName || "-";
  item.productNameAr = product?.nameAr || item.productNameAr || "";
  item.productNameHi = product?.nameHi || item.productNameHi || "";
  item.packing = getProductPacking(product);
};

/* ================= CREATE SALES INVOICE ================= */
exports.createSalesInvoice = async (req, res) => {
  try {
    const branchId = req.user.branchId || null;
    const {
      partyId: bodyPartyId,
      vendorId,
      customerId,
      paymentType: bodyPaymentType,
      bankAccountId: bodyBankAccountId,
      items,
      tax = 0,
      paidAmount = 0,
      invoiceDate,
      customerBranch = "",
      customerAttn = "",
      customerTel = "",
      salesman = "",
      lpoNo = "",
    } = req.body;
    const partyId = bodyPartyId || customerId || vendorId;

    const paymentType = String(bodyPaymentType || "credit").toLowerCase();
    const isCredit = paymentType === "credit";
    const isCashOrBank = paymentType === "cash" || paymentType === "bank";
    let bankAccountId = null;

    if ((!partyId && isCredit) || !items || items.length === 0) {
      return res.status(400).json({ message: "Customer & items required" });
    }

    /* 🔎 Validate Party is Vendor (Customer) */
    if (!isCredit && !isCashOrBank) {
      return res.status(400).json({ message: "Invalid paymentType" });
    }
    if (paymentType === "bank") {
      if (!bodyBankAccountId) {
        return res.status(400).json({ message: "bankAccountId is required for bank payments" });
      }
      const bankAccount = await BankAccount.findOne({
        _id: bodyBankAccountId,
        companyId: req.user.companyId,
      }).select("_id");
      if (!bankAccount) {
        return res.status(400).json({ message: "Invalid bank account" });
      }
      bankAccountId = bankAccount._id;
    }

    let party = null;
    if (partyId) {
      party = await Party.findOne({
        ...withBranchScope({ _id: partyId, companyId: req.user.companyId }, branchId, req.user.branchIsDefault),
        roles: { $in: ["customer", "vendor"] },
      });

      if (!party) {
        return res.status(400).json({
          message: "Invalid customer party",
        });
      }
    }

    // 1️⃣ Validate stock
    for (const item of items) {
      await ensureLegacyBatch(req.user.companyId, branchId, item.productId, invoiceDate || new Date(), req.user.branchIsDefault);
    }
    const saleValidation = await validateStockForSale(req.user.companyId, branchId, items, req.user.branchIsDefault);
    const saleProducts = await loadSaleProducts(req.user.companyId, items);

    // 2️⃣ Calculate totals
    let subtotal = 0;
    items.forEach((i) => {
      if (!i.productId || !i.quantity || !i.rate) {
        throw new Error("Invalid item");
      }
      i.amount = i.quantity * i.rate;
      subtotal += i.amount;
    });

    for (const item of items) {
      applyInvoiceItemSnapshot(item, saleProducts.get(String(item.productId)));
      const { breakdown, actualCost } = await consumeBatches({
        companyId: req.user.companyId,
        branchId,
        productId: item.productId,
        quantity: item.quantity,
        asOfDate: invoiceDate || new Date(),
        sourceHint: "SALE",
        allowNegative: !saleValidation.stockSettlementEnabled,
        branchIsDefault: req.user.branchIsDefault,
      });
      item.costBreakdown = breakdown;
      item.actualCost = Number(actualCost || 0);
      item.profitAmount = Number((item.amount - item.actualCost).toFixed(4));
    }

    const totalAmount = subtotal + tax;

    const requestedPaid = Number(paidAmount || 0);
    if (requestedPaid > totalAmount) {
      return res.status(400).json({
        message: "Paid amount cannot exceed invoice total",
      });
    }

    const finalPaidAmount = isCredit ? requestedPaid : totalAmount;

    // 3️⃣ Auto Invoice No
    const count = await SalesInvoice.countDocuments({
      companyId: req.user.companyId,
    });

    const invoiceNo = `SAL-${count + 1}`;

    // 4️⃣ Create invoice
    const invoice = await SalesInvoice.create({
      companyId: req.user.companyId,
      branchId,
      partyId: partyId || undefined,
      paymentType,
      bankAccountId,
      invoiceNo,
      invoiceDate,
      customerBranch: String(customerBranch || "").trim(),
      customerAttn: String(customerAttn || "").trim(),
      customerTel: String(customerTel || "").trim(),
      salesman: String(salesman || "").trim(),
      lpoNo: String(lpoNo || "").trim(),
      items,
      subtotal,
      tax,
      totalAmount,
      paidAmount: finalPaidAmount,
      pendingAmount: Math.max(0, totalAmount - finalPaidAmount),
      status:
        finalPaidAmount >= totalAmount
          ? "PAID"
          : finalPaidAmount > 0
            ? "PARTIAL"
            : "DUE",
    });

    // 5️⃣ Stock Ledger (SALE)
    for (const item of items) {
      await StockLedger.create({
        companyId: req.user.companyId,
        branchId,
        productId: item.productId,
        type: "SALE",
        quantity: item.quantity,
        rate: item.rate,
        referenceType: "SALES_INVOICE",
        referenceId: invoice._id,
      });
      await Product.updateOne(
        { _id: item.productId, companyId: req.user.companyId },
        { $set: { lastSalePrice: Number(item.rate || 0) } },
      );
    }

    /* ================= UPDATE PARTY BALANCE ================= */
    if (party) {
      party.balance = party.balance || 0;
      party.balance += totalAmount - finalPaidAmount;
      await party.save();
    }

    /* ================= CREATE INITIAL PAYMENT ENTRY (IF ANY) ================= */
    if (finalPaidAmount > 0) {
      await Payment.create({
        companyId: req.user.companyId,
        branchId,
        partyId: party ? party._id : undefined,
        invoiceType: "SALE",
        invoiceId: invoice._id,
        paymentType: "RECEIVED",
        amount: finalPaidAmount,
        paymentMode: paymentType === "bank" ? "BANK" : "CASH",
        bankAccountId,
        remarks: party ? "Payment at invoice creation" : "Walk-in payment at invoice creation",
        paymentDate: invoice.invoiceDate || new Date(),
      });
    }

    res.json(toSalesResponse(invoice));
  } catch (err) {
    console.error(err);
    if (err.code === "INSUFFICIENT_STOCK") {
      return res.status(400).json({
        error: "Insufficient stock",
        productId: err.productId,
        productName: err.productName,
        availableStock: err.availableStock,
      });
    }
    res.status(400).json({ error: err.message });
  }
};

/* ================= GET SALES LIST ================= */
exports.getSales = async (req, res) => {
  const status = String(req.query.status || "active").toLowerCase();
  const query = withBranchScope(
    {
      companyId: req.user.companyId,
      ...(status === "deleted" ? { isDeleted: true } : {}),
    },
    req.user.branchId,
    req.user.branchIsDefault,
  );
  const withDeleted = status === "deleted" || status === "all";
  const dateRange = getDateRangeFromQuery(req.query);
  if (dateRange) {
    query.invoiceDate = { $gte: dateRange.fromDate, $lte: dateRange.toDate };
  }
  if (req.query.paymentType) {
    query.paymentType = String(req.query.paymentType).toLowerCase();
  }

  const data = await SalesInvoice.find(query)
    .setOptions({ withDeleted })
    .populate("partyId", "name")
    .sort({ createdAt: -1 });

  res.json(data.map(toSalesResponse));
};

/* ================= GET SALES BY ID ================= */
exports.getSalesById = async (req, res) => {
  const invoice = await SalesInvoice.findOne(
    withBranchScope(
      {
        _id: req.params.id,
        companyId: req.user.companyId,
      },
      req.user.branchId,
      req.user.branchIsDefault,
    ),
  )
    .setOptions({ withDeleted: req.query.status === "deleted" || req.query.status === "all" })
    .populate("partyId", "name")
    .populate("items.productId", "name");

  res.json(toSalesResponse(invoice));
};

/* ================= UPDATE SALES INVOICE ================= */
exports.updateSalesInvoice = async (req, res) => {
  try {
    const branchId = req.user.branchId || null;
    const { id } = req.params;
    const {
      partyId: bodyPartyId,
      vendorId,
      customerId,
      paymentType: bodyPaymentType,
      bankAccountId: bodyBankAccountId,
      items,
      tax = 0,
      paidAmount = 0,
      invoiceDate,
      customerBranch = "",
      customerAttn = "",
      customerTel = "",
      salesman = "",
      lpoNo = "",
    } = req.body;
    const partyId = bodyPartyId || customerId || vendorId;

    const invoice = await SalesInvoice.findOne(
      withBranchScope(
        {
          _id: id,
          companyId: req.user.companyId,
        },
        branchId,
        req.user.branchIsDefault,
      ),
    );

    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    const paymentType = String(bodyPaymentType || invoice.paymentType || "credit").toLowerCase();
    const isCredit = paymentType === "credit";
    const isCashOrBank = paymentType === "cash" || paymentType === "bank";
    let bankAccountId = null;

    /* ❌ ALLOW EDIT ONLY SAME DAY */
    const today = new Date().toISOString().slice(0, 10);
    const invoiceDay = new Date(invoice.invoiceDate).toISOString().slice(0, 10);

    if (today !== invoiceDay) {
      return res.status(400).json({
        message: "Sales invoice can only be edited on the same day",
      });
    }

    if (!isCredit && !isCashOrBank) {
      return res.status(400).json({ message: "Invalid paymentType" });
    }
    if (paymentType === "bank") {
      if (!bodyBankAccountId) {
        return res.status(400).json({ message: "bankAccountId is required for bank payments" });
      }
      const bankAccount = await BankAccount.findOne({
        _id: bodyBankAccountId,
        companyId: req.user.companyId,
      }).select("_id");
      if (!bankAccount) {
        return res.status(400).json({ message: "Invalid bank account" });
      }
      bankAccountId = bankAccount._id;
    }

    if (!partyId && isCredit) {
      return res.status(400).json({ message: "Customer is required for credit invoices" });
    }

    /* ================= REVERSE OLD DATA ================= */

    // Reverse old party balance
    const oldParty = invoice.partyId ? await Party.findById(invoice.partyId) : null;
    if (oldParty) {
      oldParty.balance -= invoice.totalAmount - invoice.paidAmount;
      await oldParty.save();
    }

    if (Array.isArray(invoice.items)) {
      for (const item of invoice.items) {
        if (Array.isArray(item.costBreakdown) && item.costBreakdown.length) {
          await restoreBatchesFromBreakdown(
            req.user.companyId,
            branchId,
            item.costBreakdown,
            item.quantity,
          );
        }
      }
    }

    // Remove old stock ledger SALE entries
    await StockLedger.deleteMany({
      referenceId: invoice._id,
      referenceType: "SALES_INVOICE",
    });

    await Payment.deleteMany({
      companyId: req.user.companyId,
      invoiceId: invoice._id,
      invoiceType: "SALE",
    });

    /* ================= VALIDATE STOCK AGAIN ================= */
    for (const item of items) {
      await ensureLegacyBatch(req.user.companyId, branchId, item.productId, invoiceDate || new Date(), req.user.branchIsDefault);
    }
    const saleValidation = await validateStockForSale(req.user.companyId, branchId, items, req.user.branchIsDefault);
    const saleProducts = await loadSaleProducts(req.user.companyId, items);

    /* ================= RECALCULATE ================= */
    let subtotal = 0;

    items.forEach((i) => {
      if (!i.productId || !i.quantity || !i.rate) {
        throw new Error("Invalid item");
      }
      i.amount = i.quantity * i.rate;
      subtotal += i.amount;
    });

    const totalAmount = subtotal + tax;

    const requestedPaid = Number(paidAmount || 0);
    if (requestedPaid > totalAmount) {
      return res.status(400).json({
        message: "Paid amount cannot exceed invoice total",
      });
    }

    const finalPaidAmount = isCredit ? requestedPaid : totalAmount;

    for (const item of items) {
      applyInvoiceItemSnapshot(item, saleProducts.get(String(item.productId)));
      const { breakdown, actualCost } = await consumeBatches({
        companyId: req.user.companyId,
        branchId,
        productId: item.productId,
        quantity: item.quantity,
        asOfDate: invoiceDate || new Date(),
        sourceHint: "SALE_EDIT",
        allowNegative: !saleValidation.stockSettlementEnabled,
        branchIsDefault: req.user.branchIsDefault,
      });
      item.costBreakdown = breakdown;
      item.actualCost = Number(actualCost || 0);
      item.profitAmount = Number((item.amount - item.actualCost).toFixed(4));
    }

    /* ================= UPDATE INVOICE ================= */
    let newParty = null;
    if (partyId) {
      newParty = await Party.findOne({
        ...withBranchScope({ _id: partyId, companyId: req.user.companyId }, branchId, req.user.branchIsDefault),
        roles: { $in: ["customer", "vendor"] },
      });
      if (!newParty) {
        return res.status(400).json({ message: "Invalid customer party" });
      }
    }

    invoice.partyId = partyId || undefined;
    invoice.paymentType = paymentType;
    invoice.bankAccountId = bankAccountId;
    invoice.customerBranch = String(customerBranch || "").trim();
    invoice.customerAttn = String(customerAttn || "").trim();
    invoice.customerTel = String(customerTel || "").trim();
    invoice.salesman = String(salesman || "").trim();
    invoice.lpoNo = String(lpoNo || "").trim();
    invoice.items = items;
    invoice.subtotal = subtotal;
    invoice.tax = tax;
    invoice.totalAmount = totalAmount;
    invoice.invoiceDate = invoiceDate;

    invoice.paidAmount = finalPaidAmount;
    invoice.pendingAmount = Math.max(0, totalAmount - finalPaidAmount);
    invoice.status =
      finalPaidAmount >= totalAmount
        ? "PAID"
        : finalPaidAmount > 0
          ? "PARTIAL"
          : "DUE";

    await invoice.save();

    /* ================= ADD STOCK LEDGER AGAIN ================= */

    for (const item of items) {
      await StockLedger.create({
        companyId: req.user.companyId,
        branchId,
        productId: item.productId,
        type: "SALE",
        quantity: item.quantity,
        rate: item.rate,
        referenceType: "SALES_INVOICE",
        referenceId: invoice._id,
      });
      await Product.updateOne(
        { _id: item.productId, companyId: req.user.companyId },
        { $set: { lastSalePrice: Number(item.rate || 0) } },
      );
    }

    /* ================= UPDATE PARTY BALANCE AGAIN ================= */
    if (newParty) {
      newParty.balance = (newParty.balance || 0) + (totalAmount - finalPaidAmount);
      await newParty.save();
    }

    if (finalPaidAmount > 0) {
      await Payment.create({
        companyId: req.user.companyId,
        branchId,
        partyId: newParty ? newParty._id : undefined,
        invoiceType: "SALE",
        invoiceId: invoice._id,
        paymentType: "RECEIVED",
        amount: finalPaidAmount,
        paymentMode: paymentType === "bank" ? "BANK" : "CASH",
        bankAccountId,
        remarks: newParty ? "Payment updated during invoice edit" : "Walk-in payment updated during invoice edit",
        paymentDate: invoice.invoiceDate || new Date(),
      });
    }

    res.json(toSalesResponse(invoice));
  } catch (err) {
    console.error(err);
    if (err.code === "INSUFFICIENT_STOCK") {
      return res.status(400).json({
        error: "Insufficient stock",
        productId: err.productId,
        productName: err.productName,
        availableStock: err.availableStock,
      });
    }
    res.status(500).json({
      message: "Failed to update sales invoice",
      error: err.message,
    });
  }
};

exports.deleteSalesInvoice = async (req, res) => {
  try {
    const invoice = await SalesInvoice.findOne(
      withBranchScope(
        {
          _id: req.params.id,
          companyId: req.user.companyId,
        },
        req.user.branchId,
        req.user.branchIsDefault,
      ),
    );

    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    const [hasPayments, hasReturns] = await Promise.all([
      Payment.exists({
        companyId: req.user.companyId,
        invoiceType: "SALE",
        invoiceId: invoice._id,
      }),
      ReturnEntry.exists({
        companyId: req.user.companyId,
        billType: "SALE",
        billId: invoice._id,
      }),
    ]);

    if (hasPayments) {
      return res.status(400).json({
        message: "Delete linked payments first before deleting this sale invoice",
      });
    }

    if (hasReturns) {
      return res.status(400).json({
        message: "Delete linked sale returns first before deleting this sale invoice",
      });
    }

    if (invoice.partyId) {
      const party = await Party.findById(invoice.partyId);
      if (party) {
        party.balance = Number(party.balance || 0) - (Number(invoice.totalAmount || 0) - Number(invoice.paidAmount || 0));
        await party.save();
      }
    }

    if (Array.isArray(invoice.items)) {
      for (const item of invoice.items) {
        if (Array.isArray(item.costBreakdown) && item.costBreakdown.length) {
          await restoreBatchesFromBreakdown(
            req.user.companyId,
            req.user.branchId || null,
            item.costBreakdown,
            item.quantity,
          );
        } else {
          await restoreByAverageCost(
            req.user.companyId,
            req.user.branchId || null,
            item.productId,
            item.quantity,
            invoice.invoiceDate || new Date(),
            req.user.branchIsDefault,
          );
        }
      }
    }

    await StockLedger.deleteMany(
      withBranchScope(
        {
          companyId: req.user.companyId,
          referenceId: invoice._id,
          referenceType: "SALES_INVOICE",
        },
        req.user.branchId,
        req.user.branchIsDefault,
      ),
    );

    invoice.isDeleted = true;
    invoice.deletedAt = new Date();
    invoice.deletedBy = req.user._id || null;
    await invoice.save();

    res.json({ message: "Sales invoice deleted successfully" });
  } catch (err) {
    res.status(400).json({ message: err.message || "Failed to delete sales invoice" });
  }
};

exports.restoreSalesInvoice = async (req, res) => {
  try {
    const branchId = req.user.branchId || null;
    const invoice = await SalesInvoice.findOne(
      withBranchScope(
        {
          _id: req.params.id,
          companyId: req.user.companyId,
          isDeleted: true,
        },
        branchId,
        req.user.branchIsDefault,
      ),
    ).setOptions({ withDeleted: true });

    if (!invoice) {
      return res.status(404).json({ message: "Deleted invoice not found" });
    }

    const updatedItems = [];
    for (const item of invoice.items || []) {
      await ensureLegacyBatch(req.user.companyId, branchId, item.productId, invoice.invoiceDate || new Date(), req.user.branchIsDefault);
    }
    const saleValidation = await validateStockForSale(req.user.companyId, branchId, invoice.items || [], req.user.branchIsDefault);
    const saleProducts = await loadSaleProducts(req.user.companyId, invoice.items || []);

    for (const item of invoice.items || []) {
      const normalizedItem = {
        productId: item.productId,
        quantity: Number(item.quantity || 0),
        rate: Number(item.rate || 0),
        amount: Number(item.amount || (Number(item.quantity || 0) * Number(item.rate || 0))),
      };
      applyInvoiceItemSnapshot(normalizedItem, saleProducts.get(String(item.productId)));
      const { breakdown, actualCost } = await consumeBatches({
        companyId: req.user.companyId,
        branchId,
        productId: item.productId,
        quantity: item.quantity,
        asOfDate: invoice.invoiceDate || new Date(),
        sourceHint: "SALE_RESTORE",
        allowNegative: !saleValidation.stockSettlementEnabled,
        branchIsDefault: req.user.branchIsDefault,
      });
      normalizedItem.costBreakdown = breakdown;
      normalizedItem.actualCost = Number(actualCost || 0);
      normalizedItem.profitAmount = Number((normalizedItem.amount - normalizedItem.actualCost).toFixed(4));
      updatedItems.push(normalizedItem);
    }

    for (const item of updatedItems) {
      await StockLedger.create({
        companyId: req.user.companyId,
        branchId,
        productId: item.productId,
        type: "SALE",
        quantity: item.quantity,
        rate: item.rate,
        referenceType: "SALES_INVOICE",
        referenceId: invoice._id,
      });
    }

    if (invoice.partyId) {
      const party = await Party.findById(invoice.partyId);
      if (party) {
        party.balance = Number(party.balance || 0) + (Number(invoice.totalAmount || 0) - Number(invoice.paidAmount || 0));
        await party.save();
      }
    }

    invoice.items = updatedItems;
    invoice.isDeleted = false;
    invoice.deletedAt = null;
    invoice.deletedBy = null;
    await invoice.save();

    res.json(toSalesResponse(invoice));
  } catch (err) {
    if (err.code === "INSUFFICIENT_STOCK") {
      return res.status(400).json({
        error: "Insufficient stock",
        productId: err.productId,
        productName: err.productName,
        availableStock: err.availableStock,
      });
    }
    res.status(400).json({ message: err.message || "Failed to restore sales invoice" });
  }
};
