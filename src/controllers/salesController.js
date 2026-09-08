const SalesInvoice = require("../models/SalesInvoice");
const mongoose = require("mongoose");
const StockLedger = require("../models/StockLedger");
const Party = require("../models/Party");
const Payment = require("../models/Payment");
const BankAccount = require("../models/BankAccount");
const Product = require("../models/Product");
const ReturnEntry = require("../models/Return");
const Applicator = require("../models/Applicator");
const Site = require("../models/Site");
const PartySite = require("../models/PartySite");
const PartySiteApplicator = require("../models/PartySiteApplicator");
const { validateStockForSale } = require("../utils/stockValidation");
const {
  consumeBatches,
  ensureLegacyBatch,
  restoreBatchesFromBreakdown,
  restoreByAverageCost,
} = require("../utils/stockUtils");
const { getDateRangeFromQuery } = require("../utils/dateRange");
const { withBranchScope } = require("../utils/branchScope");

const applySearchFilter = (query, searchFilter) => {
  if (query.$or) {
    const existingOr = query.$or;
    delete query.$or;
    query.$and = [...(query.$and || []), { $or: existingOr }, searchFilter];
    return;
  }
  Object.assign(query, searchFilter);
};
const { logAudit } = require("../utils/auditLog");
const { getCompanyGstEnabled } = require("../utils/companySettings");
const { calculateInvoiceTotals } = require("../utils/invoiceTotals");

const toSalesResponse = (invoiceDoc) => {
  const invoice = invoiceDoc.toObject ? invoiceDoc.toObject() : invoiceDoc;
  return {
    ...invoice,
    vendorId: invoice.partyId,
    customerId: invoice.partyId,
  };
};

const normalizeInvoiceNo = (value = "") => String(value || "").trim();

const withSession = (query, session) => (session ? query.session(session) : query);

const findDuplicateSalesInvoiceNo = (companyId, invoiceNo, excludeId = null, session = null) => {
  const normalized = normalizeInvoiceNo(invoiceNo);
  if (!normalized) return null;
  return withSession(
    SalesInvoice.findOne({
      companyId,
      invoiceNo: normalized,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
      isDeleted: false,
    }).select("_id invoiceNo"),
    session,
  );
};

const generateSalesInvoiceNo = async (companyId, session = null) => {
  const lastInvoice = await withSession(
    SalesInvoice.findOne({ companyId, invoiceNo: { $exists: true, $ne: "" } })
      .sort({ createdAt: -1, _id: -1 })
      .select("invoiceNo")
      .lean(),
    session,
  );
  const lastNo = normalizeInvoiceNo(lastInvoice?.invoiceNo);
  const match = lastNo.match(/^(.*?)(\d+)$/);
  if (match) {
    const [, prefix, suffix] = match;
    let nextNumber = Number(suffix) + 1;
    let invoiceNo = `${prefix}${String(nextNumber).padStart(suffix.length, "0")}`;
    while (await findDuplicateSalesInvoiceNo(companyId, invoiceNo, null, session)) {
      nextNumber += 1;
      invoiceNo = `${prefix}${String(nextNumber).padStart(suffix.length, "0")}`;
    }
    return invoiceNo;
  }

  const count = await withSession(SalesInvoice.countDocuments({ companyId }), session);
  let next = count + 1;
  let invoiceNo = `SAL-${next}`;
  while (await findDuplicateSalesInvoiceNo(companyId, invoiceNo, null, session)) {
    next += 1;
    invoiceNo = `SAL-${next}`;
  }
  return invoiceNo;
};

const ensurePartySiteAssignment = async (req, partyId, siteId, session = null) => {
  if (!partyId || !siteId) return;
  await PartySite.findOneAndUpdate(
    {
      adminId: req.user.companyId,
      partyId,
      siteId,
      isDeleted: false,
    },
    {
      $setOnInsert: {
        adminId: req.user.companyId,
        branchId: req.user.branchId || null,
        partyId,
        siteId,
        createdBy: req.user.userId || req.user._id || null,
      },
      $set: {
        status: "active",
        isDeleted: false,
        updatedBy: req.user.userId || req.user._id || null,
      },
    },
    { upsert: true, new: true, session },
  );
};

const ensurePartySiteApplicatorAssignment = async (req, partyId, siteId, applicatorId, session = null) => {
  if (!partyId || !siteId || !applicatorId) return;
  await PartySiteApplicator.findOneAndUpdate(
    {
      adminId: req.user.companyId,
      partyId,
      siteId,
      applicatorId,
      isDeleted: false,
    },
    {
      $setOnInsert: {
        adminId: req.user.companyId,
        branchId: req.user.branchId || null,
        partyId,
        siteId,
        applicatorId,
        createdBy: req.user.userId || req.user._id || null,
      },
      $set: {
        status: "active",
        isDeleted: false,
        updatedBy: req.user.userId || req.user._id || null,
      },
    },
    { upsert: true, new: true, session },
  );
};

const resolveSiteSnapshot = async (req, partyId, siteId, customerBranch = "") => {
  if (!siteId) return { siteId: null, customerBranch: String(customerBranch || "").trim() };
  const site = await Site.findOne({
    _id: siteId,
    adminId: req.user.companyId,
    status: "active",
    isDeleted: false,
  }).select("_id name");
  if (!site) {
    const err = new Error("Invalid site");
    err.status = 400;
    throw err;
  }
  return {
    siteId: site._id,
    customerBranch: String(customerBranch || site.name || "").trim(),
  };
};

const resolveApplicatorSnapshot = async (req, applicatorId) => {
  if (!applicatorId) return { applicatorId: null, applicatorName: "" };
  const applicator = await Applicator.findOne({
    _id: applicatorId,
    adminId: req.user.companyId,
    status: "active",
    isDeleted: false,
  }).select("_id name");
  if (!applicator) {
    const err = new Error("Invalid applicator");
    err.status = 400;
    throw err;
  }
  return {
    applicatorId: applicator._id,
    applicatorName: applicator.name,
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

const loadSaleProducts = async (companyId, items = [], session = null) => {
  const productIds = [
    ...new Set((items || []).map((item) => String(item.productId || "")).filter(Boolean)),
  ];
  const products = await withSession(
    Product.find({
      _id: { $in: productIds },
      companyId,
    }).select("name nameAr nameHi sku attributes unitId unitName"),
    session,
  );

  return new Map(products.map((product) => [String(product._id), product]));
};

const applyInvoiceItemSnapshot = (item, product) => {
  item.productName = product?.name || item.productName || "-";
  item.productNameAr = product?.nameAr || item.productNameAr || "";
  item.productNameHi = product?.nameHi || item.productNameHi || "";
  item.unitId = product?.unitId || item.unitId || null;
  item.unitName = product?.unitName || item.unitName || "";
  item.packing = getProductPacking(product);
};

const findReplacementReturnForInvoice = async (
  companyId,
  invoiceId,
  branchId,
  branchIsDefault = false,
) =>
  ReturnEntry.findOne(
    withBranchScope(
      {
        companyId,
        replacementBillType: "SALE",
        replacementBillId: invoiceId,
      },
      branchId,
      branchIsDefault,
    ),
  )
    .setOptions({ withDeleted: true })
    .populate("partyId", "name");

/* ================= CREATE SALES INVOICE ================= */
exports.createSalesInvoice = async (req, res) => {
  try {
    const branchId = req.user.branchId || null;
    const branchScope = req.user.branchScope || branchId;
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
      siteId,
      applicatorId,
      customerBranch = "",
      customerAttn = "",
      customerTel = "",
      salesman = "",
      lpoNo = "",
      invoiceNo: bodyInvoiceNo = "",
      isGST = false,
      otherCharges: bodyOtherCharges = [],
    } = req.body;
    const partyId = bodyPartyId || customerId || vendorId;

    const paymentType = String(bodyPaymentType || "credit").toLowerCase();
    const isCredit = paymentType === "credit";
    const isCashOrBank = paymentType === "cash" || paymentType === "bank";
    let bankAccountId = null;

    if ((!partyId && isCredit) || !items || items.length === 0) {
      return res.status(400).json({ message: "Customer & items required" });
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

    const siteSnapshot = await resolveSiteSnapshot(req, partyId, siteId, customerBranch);
    const applicatorSnapshot = await resolveApplicatorSnapshot(req, applicatorId);

    const gstEnabled = await getCompanyGstEnabled(req.user.companyId);

    items.forEach((i) => {
      if (!i.productId || !i.quantity || !i.rate) {
        throw new Error("Invalid item");
      }
    });
    const { subtotal, tax: invoiceTax, otherCharges, otherChargesTotal, totalAmount } = calculateInvoiceTotals(items, {
      tax,
      gstEnabled,
      otherCharges: bodyOtherCharges,
    });

    const requestedPaid = Number(paidAmount || 0);
    if (requestedPaid > totalAmount) {
      return res.status(400).json({
        message: "Paid amount cannot exceed invoice total",
      });
    }

    const finalPaidAmount = isCredit ? requestedPaid : totalAmount;

    const session = await mongoose.startSession();
    let invoice = null;
    try {
      await session.withTransaction(async () => {
        const invoiceNo = normalizeInvoiceNo(bodyInvoiceNo) || await generateSalesInvoiceNo(req.user.companyId, session);
        const duplicate = await findDuplicateSalesInvoiceNo(req.user.companyId, invoiceNo, null, session);
        if (duplicate) {
          const error = new Error("Sales Bill Number already exists.");
          error.status = 409;
          error.code = "DUPLICATE_BILL_NUMBER";
          throw error;
        }

        for (const item of items) {
          await ensureLegacyBatch(
            req.user.companyId,
            branchId,
            item.productId,
            invoiceDate || new Date(),
            req.user.branchIsDefault,
            { session },
          );
        }
        const saleValidation = await validateStockForSale(
          req.user.companyId,
          branchId,
          items,
          req.user.branchIsDefault,
          { session },
        );
        const saleProducts = await loadSaleProducts(req.user.companyId, items, session);

        for (const item of items) {
          applyInvoiceItemSnapshot(item, saleProducts.get(String(item.productId)));
          const { breakdown, actualCost } = await consumeBatches({
            companyId: req.user.companyId,
            branchId: branchScope,
            productId: item.productId,
            quantity: item.quantity,
            asOfDate: invoiceDate || new Date(),
            sourceHint: "SALE",
            allowNegative: !saleValidation.stockSettlementEnabled,
            branchIsDefault: req.user.branchIsDefault,
            session,
          });
          item.costBreakdown = breakdown;
          item.actualCost = Number(actualCost || 0);
          item.profitAmount = Number((item.amount - item.actualCost).toFixed(4));
        }

        const createdInvoices = await SalesInvoice.create([{
          companyId: req.user.companyId,
          branchId,
          siteId: siteSnapshot.siteId,
          ...applicatorSnapshot,
          partyId: partyId || undefined,
          paymentType,
          bankAccountId,
          invoiceNo,
          isGST: Boolean(isGST),
          invoiceDate,
          customerBranch: siteSnapshot.customerBranch,
          customerAttn: String(customerAttn || "").trim(),
          customerTel: String(customerTel || "").trim(),
          salesman: String(salesman || "").trim(),
          lpoNo: String(lpoNo || "").trim(),
          items,
          subtotal,
          tax: invoiceTax,
          otherCharges,
          otherChargesTotal,
          totalAmount,
          paidAmount: finalPaidAmount,
          pendingAmount: Math.max(0, totalAmount - finalPaidAmount),
          status:
            finalPaidAmount >= totalAmount
              ? "PAID"
              : finalPaidAmount > 0
                ? "PARTIAL"
                : "DUE",
        }], { session });
        invoice = createdInvoices[0];

        for (const item of items) {
          await StockLedger.create([{
            companyId: req.user.companyId,
            branchId,
            productId: item.productId,
            type: "SALE",
            quantity: item.quantity,
            rate: item.rate,
            referenceType: "SALES_INVOICE",
            referenceId: invoice._id,
          }], { session });
          await Product.updateOne(
            { _id: item.productId, companyId: req.user.companyId },
            { $set: { lastSalePrice: Number(item.rate || 0) } },
            { session },
          );
        }

        if (party) {
          await Party.updateOne(
            { _id: party._id, companyId: req.user.companyId },
            { $inc: { balance: totalAmount - finalPaidAmount } },
            { session },
          );
        }

        await ensurePartySiteAssignment(req, partyId, siteSnapshot.siteId, session);
        await ensurePartySiteApplicatorAssignment(req, partyId, siteSnapshot.siteId, applicatorSnapshot.applicatorId, session);

        if (finalPaidAmount > 0) {
          await Payment.create([{
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
          }], { session });
        }
      });
    } finally {
      await session.endSession();
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
    if (err.code === "DUPLICATE_BILL_NUMBER" || err.code === 11000) {
      return res.status(409).json({
        success: false,
        code: "DUPLICATE_BILL_NUMBER",
        message: "Sales Bill Number already exists.",
      });
    }
    if (err.name === "ValidationError" || err.name === "CastError" || err.status === 400) {
      return res.status(400).json({ error: err.message });
    }
    res.status(err.status || 500).json({ error: err.message || "Failed to create sales invoice" });
  }
};

/* ================= GET SALES LIST ================= */
exports.getSales = async (req, res) => {
  const status = String(req.query.status || "active").toLowerCase();
  const withDeleted = status === "deleted" || status === "all";
  const dateRange = getDateRangeFromQuery(req.query);

  if (String(req.query.type || "").toLowerCase() === "replacement") {
    const replacementReturnQuery = withBranchScope(
      {
        companyId: req.user.companyId,
        replacementBillType: "SALE",
        replacementBillId: { $ne: null },
        ...(status === "deleted" ? { isDeleted: true } : {}),
      },
      req.user.branchId,
      req.user.branchIsDefault,
    );

    if (dateRange) {
      replacementReturnQuery.returnDate = {
        $gte: dateRange.fromDate,
        $lte: dateRange.toDate,
      };
    }

    const replacementReturns = await ReturnEntry.find(replacementReturnQuery)
      .setOptions({ withDeleted })
      .populate("partyId", "name")
      .sort({ returnDate: -1, createdAt: -1 });

    const invoiceIds = [
      ...new Set(
        replacementReturns
          .map((entry) => String(entry.replacementBillId || ""))
          .filter(Boolean),
      ),
    ];

    if (!invoiceIds.length) {
      return res.json([]);
    }

    const invoiceQuery = withBranchScope(
      {
        companyId: req.user.companyId,
        _id: { $in: invoiceIds },
        ...(status === "deleted" ? { isDeleted: true } : {}),
      },
      req.user.branchId,
      req.user.branchIsDefault,
    );

    if (dateRange) {
      invoiceQuery.invoiceDate = {
        $gte: dateRange.fromDate,
        $lte: dateRange.toDate,
      };
    }

    if (req.query.paymentType) {
      invoiceQuery.paymentType = String(req.query.paymentType).toLowerCase();
    }

    const invoices = await SalesInvoice.find(invoiceQuery)
      .setOptions({ withDeleted })
      .populate("partyId", "name")
      .sort({ invoiceDate: -1, createdAt: -1 });

    const replacementMap = new Map(
      replacementReturns.map((entry) => [String(entry.replacementBillId), entry]),
    );

    return res.json(
      invoices.map((invoiceDoc) => {
        const replacementReturn = replacementMap.get(String(invoiceDoc._id));
        return {
          ...toSalesResponse(invoiceDoc),
          linkedReturnId: replacementReturn?._id || null,
          linkedReturnNo: replacementReturn?.returnNo || "",
          linkedReturnDate: replacementReturn?.returnDate || null,
          replacementBillType: "SALE",
        };
      }),
    );
  }

  const query = withBranchScope(
    {
      companyId: req.user.companyId,
      ...(status === "deleted" ? { isDeleted: true } : {}),
    },
    req.user.branchId,
    req.user.branchIsDefault,
  );
  if (dateRange) {
    query.invoiceDate = { $gte: dateRange.fromDate, $lte: dateRange.toDate };
  }
  if (req.query.applicatorId) {
    query.applicatorId = req.query.applicatorId;
  }
  if (req.query.partyId || req.query.customerId || req.query.vendorId) {
    query.partyId = req.query.partyId || req.query.customerId || req.query.vendorId;
  }
  if (req.query.siteId) {
    query.siteId = req.query.siteId;
  }
  if (req.query.isGST !== undefined) {
    query.isGST = String(req.query.isGST).toLowerCase() === "true";
  }
  if (req.query.paymentType) {
    query.paymentType = String(req.query.paymentType).toLowerCase();
  }
  if (req.query.paymentStatus || req.query.invoiceStatus) {
    query.status = String(req.query.paymentStatus || req.query.invoiceStatus).toUpperCase();
  }

  const search = String(req.query.search || "").trim();
  if (search) {
    const searchRegex = new RegExp(search, "i");
    const [partyIds, productIds] = await Promise.all([
      Party.distinct("_id", withBranchScope({ companyId: req.user.companyId, name: searchRegex, isActive: true }, req.user.branchId, req.user.branchIsDefault)),
      Product.distinct("_id", withBranchScope({ companyId: req.user.companyId, name: searchRegex }, req.user.branchId, req.user.branchIsDefault)).setOptions({ withDeleted: false }),
    ]);
    applySearchFilter(query, { $or: [
      { invoiceNo: searchRegex },
      { customerBranch: searchRegex },
      { applicatorName: searchRegex },
      { customerTel: searchRegex },
      { partyId: { $in: partyIds } },
      { "items.productId": { $in: productIds } },
      { "items.productName": searchRegex },
    ] });
  }

  const data = await SalesInvoice.find(query)
    .setOptions({ withDeleted })
    .populate("partyId", "name phone mobile email")
    .populate("siteId", "name address")
    .populate("applicatorId", "name mobile")
    .populate("items.productId", "name unitId unitName")
    .sort({ createdAt: -1 });

  res.json(data.map(toSalesResponse));
};

exports.getReplacementBills = async (req, res) => {
  req.query.type = "replacement";
  return exports.getSales(req, res);
};

exports.checkSalesInvoiceNumber = async (req, res) => {
  try {
    const invoiceNo = normalizeInvoiceNo(req.query.billNumber || req.query.invoiceNo || "");
    if (!invoiceNo) {
      return res.json({ success: true, exists: false });
    }
    const duplicate = await findDuplicateSalesInvoiceNo(req.user.companyId, invoiceNo, req.query.excludeId || null);
    res.json({ success: true, exists: Boolean(duplicate) });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to check sales bill number" });
  }
};

exports.getNextSalesInvoiceNumber = async (req, res) => {
  try {
    const invoiceNo = await generateSalesInvoiceNo(req.user.companyId);
    res.json({ success: true, invoiceNo });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to generate sales bill number" });
  }
};

exports.updateSalesInvoiceGstStatus = async (req, res) => {
  try {
    const isGST = Boolean(req.body.isGST);
    const invoice = await SalesInvoice.findOneAndUpdate(
      withBranchScope(
        {
          _id: req.params.id,
          companyId: req.user.companyId,
        },
        req.user.branchId,
        req.user.branchIsDefault,
      ),
      { isGST },
      { new: true },
    );
    if (!invoice) {
      return res.status(404).json({ success: false, message: "Invoice not found" });
    }
    res.json({
      success: true,
      message: isGST
        ? "Invoice added to GST bills successfully"
        : "Invoice removed from GST bills successfully",
      invoice: toSalesResponse(invoice),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to update GST status" });
  }
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
    .populate("partyId", "name phone mobile email")
    .populate("siteId", "name address")
    .populate("applicatorId", "name mobile")
    .populate("items.productId", "name unitId unitName");

  res.json(toSalesResponse(invoice));
};

/* ================= UPDATE SALES INVOICE ================= */
exports.updateSalesInvoice = async (req, res) => {
  try {
    const branchId = req.user.branchId || null;
    const branchScope = req.user.branchScope || branchId;
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
      siteId,
      applicatorId,
      customerBranch = "",
      customerAttn = "",
      customerTel = "",
      salesman = "",
      lpoNo = "",
      invoiceNo: bodyInvoiceNo = "",
      isGST = false,
      otherCharges: bodyOtherCharges = [],
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

    const siteSnapshot = await resolveSiteSnapshot(req, partyId, siteId, customerBranch);
    const applicatorSnapshot = await resolveApplicatorSnapshot(req, applicatorId);

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
            branchScope,
            item.costBreakdown,
            item.quantity,
          );
        }
      }
    }

    await StockLedger.deleteMany({
      referenceId: invoice._id,
      referenceType: "SALES_INVOICE",
    });

    await Payment.deleteMany({
      companyId: req.user.companyId,
      invoiceId: invoice._id,
      invoiceType: "SALE",
    });

    for (const item of items) {
      await ensureLegacyBatch(req.user.companyId, branchId, item.productId, invoiceDate || new Date(), req.user.branchIsDefault);
    }
    const saleValidation = await validateStockForSale(req.user.companyId, branchId, items, req.user.branchIsDefault);
    const saleProducts = await loadSaleProducts(req.user.companyId, items);

    const gstEnabled = await getCompanyGstEnabled(req.user.companyId);

    items.forEach((i) => {
      if (!i.productId || !i.quantity || !i.rate) {
        throw new Error("Invalid item");
      }
    });
    const { subtotal, tax: invoiceTax, otherCharges, otherChargesTotal, totalAmount } = calculateInvoiceTotals(items, {
      tax,
      gstEnabled,
      otherCharges: bodyOtherCharges,
    });

    const requestedPaid = Number(paidAmount || 0);
    if (requestedPaid > totalAmount) {
      return res.status(400).json({
        message: "Paid amount cannot exceed invoice total",
      });
    }

    const finalPaidAmount = isCredit ? requestedPaid : totalAmount;
    const nextInvoiceNo = normalizeInvoiceNo(bodyInvoiceNo) || invoice.invoiceNo;
    if (!nextInvoiceNo) {
      return res.status(400).json({ message: "Sales Bill Number is required" });
    }
    const duplicate = await findDuplicateSalesInvoiceNo(req.user.companyId, nextInvoiceNo, invoice._id);
    if (duplicate) {
      return res.status(409).json({
        success: false,
        code: "DUPLICATE_BILL_NUMBER",
        message: "Sales Bill Number already exists.",
      });
    }

    for (const item of items) {
      applyInvoiceItemSnapshot(item, saleProducts.get(String(item.productId)));
      const { breakdown, actualCost } = await consumeBatches({
        companyId: req.user.companyId,
        branchId: branchScope,
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
    invoice.siteId = siteSnapshot.siteId;
    invoice.applicatorId = applicatorSnapshot.applicatorId;
    invoice.applicatorName = applicatorSnapshot.applicatorName;
    invoice.customerBranch = siteSnapshot.customerBranch;
    invoice.customerAttn = String(customerAttn || "").trim();
    invoice.customerTel = String(customerTel || "").trim();
    invoice.salesman = String(salesman || "").trim();
    invoice.lpoNo = String(lpoNo || "").trim();
    invoice.invoiceNo = nextInvoiceNo;
    invoice.isGST = Boolean(isGST);
    invoice.items = items;
    invoice.subtotal = subtotal;
    invoice.tax = invoiceTax;
    invoice.otherCharges = otherCharges;
    invoice.otherChargesTotal = otherChargesTotal;
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

    if (newParty) {
      newParty.balance = (newParty.balance || 0) + (totalAmount - finalPaidAmount);
      await newParty.save();
    }

    await ensurePartySiteAssignment(req, partyId, siteSnapshot.siteId);
    await ensurePartySiteApplicatorAssignment(req, partyId, siteSnapshot.siteId, applicatorSnapshot.applicatorId);

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

    const linkedReplacementReturn = await findReplacementReturnForInvoice(
      req.user.companyId,
      invoice._id,
      branchId,
      req.user.branchIsDefault,
    );
    if (linkedReplacementReturn) {
      await logAudit({
        companyId: req.user.companyId,
        userId: req.user._id || null,
        actionType: "UPDATE",
        module: "REPLACEMENT_BILL",
        entityId: invoice._id,
        description: `Updated replacement bill ${invoice.invoiceNo || invoice._id}`,
        details: {
          apiName: "PUT /api/sales/:id",
          branchId,
          invoiceId: invoice._id,
          invoiceNo: invoice.invoiceNo || "",
          linkedReturnId: linkedReplacementReturn._id,
          linkedReturnNo: linkedReplacementReturn.returnNo || "",
          totalAmount: Number(invoice.totalAmount || 0),
          paidAmount: Number(invoice.paidAmount || 0),
          status: invoice.status || "",
        },
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
    const branchScope = req.user.branchScope || req.user.branchId || null;
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

    const linkedReplacementReturn = await findReplacementReturnForInvoice(
      req.user.companyId,
      invoice._id,
      req.user.branchId,
      req.user.branchIsDefault,
    );

    const [hasPayments, hasReturns] = await Promise.all([
      Payment.exists({
        ...withBranchScope(
          {
            companyId: req.user.companyId,
            invoiceType: "SALE",
            invoiceId: invoice._id,
          },
          branchScope,
        ),
      }),
      ReturnEntry.exists({
        ...withBranchScope(
          {
            companyId: req.user.companyId,
            billType: "SALE",
            billId: invoice._id,
          },
          branchScope,
        ),
      }),
    ]);

    if (hasPayments && !linkedReplacementReturn) {
      return res.status(400).json({
        message: "Delete linked payments first before deleting this sale invoice",
      });
    }

    if (hasReturns) {
      return res.status(400).json({
        message: "Delete linked sale returns first before deleting this sale invoice",
      });
    }

    if (linkedReplacementReturn) {
      await Payment.deleteMany({
        companyId: req.user.companyId,
        invoiceType: "SALE",
        invoiceId: invoice._id,
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
            branchScope,
            item.costBreakdown,
            item.quantity,
          );
        } else {
          await restoreByAverageCost(
            req.user.companyId,
            branchScope,
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

    if (linkedReplacementReturn) {
      linkedReplacementReturn.hasReplacement = false;
      linkedReplacementReturn.replacementBillId = undefined;
      linkedReplacementReturn.replacementBillType = undefined;
      linkedReplacementReturn.netDifference = 0;
      await linkedReplacementReturn.save();

      await logAudit({
        companyId: req.user.companyId,
        userId: req.user._id || null,
        actionType: "DELETE",
        module: "REPLACEMENT_BILL",
        entityId: invoice._id,
        description: `Deleted replacement bill ${invoice.invoiceNo || invoice._id}`,
        details: {
          apiName: "DELETE /api/sales/:id",
          branchId: req.user.branchId || null,
          invoiceId: invoice._id,
          invoiceNo: invoice.invoiceNo || "",
          linkedReturnId: linkedReplacementReturn._id,
          linkedReturnNo: linkedReplacementReturn.returnNo || "",
          totalAmount: Number(invoice.totalAmount || 0),
          status: "DELETED",
        },
      });
    }

    res.json({ message: "Sales invoice deleted successfully" });
  } catch (err) {
    res.status(400).json({ message: err.message || "Failed to delete sales invoice" });
  }
};

exports.restoreSalesInvoice = async (req, res) => {
  try {
    const branchId = req.user.branchId || null;
    const branchScope = req.user.branchScope || branchId;
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
        branchId: branchScope,
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






