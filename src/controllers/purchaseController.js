const PurchaseInvoice = require("../models/PurchaseInvoice");
const StockLedger = require("../models/StockLedger");
const StockBatch = require("../models/StockBatch");
const Party = require("../models/Party");
const Payment = require("../models/Payment");
const BankAccount = require("../models/BankAccount");
const Product = require("../models/Product");
const ReturnEntry = require("../models/Return");
const { getDateRangeFromQuery } = require("../utils/dateRange");
const { withBranchScope } = require("../utils/branchScope");

const toPurchaseResponse = (invoiceDoc) => {
  const invoice = invoiceDoc.toObject ? invoiceDoc.toObject() : invoiceDoc;
  return {
    ...invoice,
    supplierId: invoice.partyId,
  };
};

/* ================= CREATE PURCHASE INVOICE ================= */
exports.createPurchaseInvoice = async (req, res) => {
  try {
    const branchId = req.user.branchId || null;
    const {
      partyId: bodyPartyId,
      supplierId,
      paymentType: bodyPaymentType,
      bankAccountId: bodyBankAccountId,
      invoiceNo,
      items,
      tax = 0,
      paidAmount = 0,
      invoiceDate,
    } = req.body;
    const partyId = bodyPartyId || supplierId;

    const paymentType = String(bodyPaymentType || "credit").toLowerCase();
    const isCredit = paymentType === "credit";
    const isCashOrBank = paymentType === "cash" || paymentType === "bank";
    let bankAccountId = null;

    if ((!partyId && isCredit) || !items || items.length === 0) {
      return res.status(400).json({
        message: "Party and items are required",
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

    let party = null;
    if (partyId) {
      party = await Party.findOne({
        ...withBranchScope({ _id: partyId, companyId: req.user.companyId }, branchId, req.user.branchIsDefault),
        roles: "supplier",
      });

      if (!party) {
        return res.status(400).json({
          message: "Invalid supplier party",
        });
      }
    }

    let subtotal = 0;
    items.forEach((i) => {
      if (!i.productId || !i.quantity || !i.rate) {
        throw new Error("Invalid item data");
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

    const normalizedInvoiceNo = String(invoiceNo || "").trim();
    if (!normalizedInvoiceNo) {
      return res.status(400).json({
        message: "Purchase bill number is required",
      });
    }

    const duplicateInvoice = await PurchaseInvoice.findOne({
      companyId: req.user.companyId,
      invoiceNo: normalizedInvoiceNo,
    }).select("_id");

    if (duplicateInvoice) {
      return res.status(400).json({
        message: "Purchase bill number already exists",
      });
    }

    const invoice = await PurchaseInvoice.create({
      companyId: req.user.companyId,
      branchId,
      partyId: partyId || undefined,
      paymentType,
      bankAccountId,
      invoiceNo: normalizedInvoiceNo,
      invoiceDate,
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

    for (const item of items) {
      await StockLedger.create({
        companyId: req.user.companyId,
        branchId,
        productId: item.productId,
        type: "PURCHASE",
        quantity: item.quantity,
        rate: item.rate,
        referenceType: "PURCHASE_INVOICE",
        referenceId: invoice._id,
      });
      await StockBatch.create({
        companyId: req.user.companyId,
        branchId,
        productId: item.productId,
        sourceType: "PURCHASE",
        sourceId: invoice._id,
        totalQty: Number(item.quantity || 0),
        remainingQty: Number(item.quantity || 0),
        rate: Number(item.rate || 0),
      });
      await Product.updateOne(
        { _id: item.productId, companyId: req.user.companyId },
        { $set: { lastPurchaseRate: Number(item.rate || 0) } },
      );
    }

    if (party) {
      party.balance = party.balance || 0;
      party.balance += totalAmount - finalPaidAmount;
      await party.save();
    }

    if (finalPaidAmount > 0) {
      await Payment.create({
        companyId: req.user.companyId,
        branchId,
        partyId: party ? party._id : undefined,
        invoiceType: "PURCHASE",
        invoiceId: invoice._id,
        paymentType: "PAID",
        amount: finalPaidAmount,
        paymentMode: paymentType === "bank" ? "BANK" : "CASH",
        bankAccountId,
        remarks: party ? "Payment at invoice creation" : "Walk-in payment at invoice creation",
        paymentDate: invoice.invoiceDate || new Date(),
      });
    }

    res.json(toPurchaseResponse(invoice));
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Failed to create purchase invoice",
      error: err.message,
    });
  }
};

/* ================= GET ALL PURCHASES ================= */
exports.getPurchases = async (req, res) => {
  const status = String(req.query.status || "active").toLowerCase();
  const query = withBranchScope(
    {
      companyId: req.user.companyId,
      ...(status === "deleted" ? { isDeleted: true } : {}),
    },
    req.user.branchId,
    req.user.branchIsDefault,
  );
  const dateRange = getDateRangeFromQuery(req.query);
  if (dateRange) {
    query.invoiceDate = { $gte: dateRange.fromDate, $lte: dateRange.toDate };
  }
  if (req.query.paymentType) {
    query.paymentType = String(req.query.paymentType).toLowerCase();
  }

  const withDeleted = status === "deleted" || status === "all";
  const data = await PurchaseInvoice.find(query)
    .setOptions({ withDeleted })
    .populate("partyId", "name")
    .sort({ createdAt: -1 });

  res.json(data.map(toPurchaseResponse));
};

/* ================= GET PURCHASE BY ID ================= */
exports.getPurchaseById = async (req, res) => {
  const invoice = await PurchaseInvoice.findOne(
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

  res.json(toPurchaseResponse(invoice));
};

/* ================= UPDATE PURCHASE INVOICE ================= */
exports.updatePurchaseInvoice = async (req, res) => {
  try {
    const branchId = req.user.branchId || null;
    const { id } = req.params;
    const {
      partyId: bodyPartyId,
      supplierId,
      paymentType: bodyPaymentType,
      bankAccountId: bodyBankAccountId,
      invoiceNo,
      items,
      tax = 0,
      paidAmount = 0,
      invoiceDate,
    } = req.body;
    const partyId = bodyPartyId || supplierId;

    const invoice = await PurchaseInvoice.findOne(
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
        message: "Invoice can only be edited on the same day",
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
      return res.status(400).json({ message: "Supplier is required for credit invoices" });
    }

    const oldParty = invoice.partyId ? await Party.findById(invoice.partyId) : null;
    if (oldParty) {
      oldParty.balance -= invoice.totalAmount - invoice.paidAmount;
      await oldParty.save();
    }

    await StockLedger.deleteMany({
      referenceId: invoice._id,
      referenceType: "PURCHASE_INVOICE",
    });
    await StockBatch.deleteMany({
      companyId: req.user.companyId,
      sourceType: "PURCHASE",
      sourceId: invoice._id,
    });

    await Payment.deleteMany({
      invoiceId: invoice._id,
      invoiceType: "PURCHASE",
    });

    let subtotal = 0;
    items.forEach((i) => {
      if (!i.productId || !i.quantity || !i.rate) {
        throw new Error("Invalid item data");
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

    let newParty = null;
    if (partyId) {
      newParty = await Party.findOne({
        ...withBranchScope({ _id: partyId, companyId: req.user.companyId }, branchId, req.user.branchIsDefault),
        roles: "supplier",
      });
      if (!newParty) {
        return res.status(400).json({ message: "Invalid supplier party" });
      }
    }

    invoice.partyId = partyId || undefined;
    invoice.paymentType = paymentType;
    invoice.bankAccountId = bankAccountId;

    const normalizedInvoiceNo = String(invoiceNo || invoice.invoiceNo || "").trim();
    if (!normalizedInvoiceNo) {
      return res.status(400).json({ message: "Purchase bill number is required" });
    }

    const duplicateInvoice = await PurchaseInvoice.findOne({
      companyId: req.user.companyId,
      invoiceNo: normalizedInvoiceNo,
      _id: { $ne: invoice._id },
    }).select("_id");

    if (duplicateInvoice) {
      return res.status(400).json({ message: "Purchase bill number already exists" });
    }

    invoice.invoiceNo = normalizedInvoiceNo;
    invoice.items = items;
    invoice.subtotal = subtotal;
    invoice.tax = tax;
    invoice.totalAmount = totalAmount;
    invoice.invoiceDate = invoiceDate;

    for (const item of items) {
      await StockLedger.create({
        companyId: req.user.companyId,
        branchId,
        productId: item.productId,
        type: "PURCHASE",
        quantity: item.quantity,
        rate: item.rate,
        referenceType: "PURCHASE_INVOICE",
        referenceId: invoice._id,
      });
      await StockBatch.create({
        companyId: req.user.companyId,
        branchId,
        productId: item.productId,
        sourceType: "PURCHASE",
        sourceId: invoice._id,
        totalQty: Number(item.quantity || 0),
        remainingQty: Number(item.quantity || 0),
        rate: Number(item.rate || 0),
      });
      await Product.updateOne(
        { _id: item.productId, companyId: req.user.companyId },
        { $set: { lastPurchaseRate: Number(item.rate || 0) } },
      );
    }

    invoice.paidAmount = finalPaidAmount;
    invoice.pendingAmount = Math.max(0, totalAmount - finalPaidAmount);
    invoice.status =
      finalPaidAmount >= totalAmount
        ? "PAID"
        : finalPaidAmount > 0
          ? "PARTIAL"
          : "DUE";

    await invoice.save();

    if (newParty) {
      newParty.balance = (newParty.balance || 0) + (totalAmount - finalPaidAmount);
      await newParty.save();
    }

    if (finalPaidAmount > 0) {
      await Payment.create({
        companyId: req.user.companyId,
        branchId,
        partyId: newParty ? newParty._id : undefined,
        invoiceType: "PURCHASE",
        invoiceId: invoice._id,
        paymentType: "PAID",
        amount: finalPaidAmount,
        paymentMode: paymentType === "bank" ? "BANK" : "CASH",
        bankAccountId,
        remarks: newParty ? "Payment updated during invoice edit" : "Walk-in payment updated during invoice edit",
        paymentDate: invoice.invoiceDate || new Date(),
      });
    }

    res.json(toPurchaseResponse(invoice));
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Failed to update purchase invoice",
      error: err.message,
    });
  }
};

exports.deletePurchaseInvoice = async (req, res) => {
  try {
    const invoice = await PurchaseInvoice.findOne(
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

    const [hasPayments, hasReturns, batches] = await Promise.all([
      Payment.exists(
        withBranchScope(
          {
            companyId: req.user.companyId,
            invoiceType: "PURCHASE",
            invoiceId: invoice._id,
          },
          req.user.branchId,
          req.user.branchIsDefault,
        ),
      ),
      ReturnEntry.exists(
        withBranchScope(
          {
            companyId: req.user.companyId,
            billType: "PURCHASE",
            billId: invoice._id,
          },
          req.user.branchId,
          req.user.branchIsDefault,
        ),
      ),
      StockBatch.find(
        withBranchScope(
          {
            companyId: req.user.companyId,
            sourceType: "PURCHASE",
            sourceId: invoice._id,
          },
          req.user.branchId,
          req.user.branchIsDefault,
        ),
      ).select("totalQty remainingQty"),
    ]);

    if (hasPayments) {
      return res.status(400).json({
        message: "Delete linked payments first before deleting this purchase invoice",
      });
    }

    if (hasReturns) {
      return res.status(400).json({
        message: "Delete linked purchase returns first before deleting this purchase invoice",
      });
    }

    const hasConsumedStock = batches.some(
      (batch) => Number(batch.remainingQty || 0) !== Number(batch.totalQty || 0),
    );

    if (hasConsumedStock) {
      return res.status(400).json({
        message: "This purchase invoice cannot be deleted because its stock has already been used",
      });
    }

    if (invoice.partyId) {
      const party = await Party.findById(invoice.partyId);
      if (party) {
        party.balance = Number(party.balance || 0) - (Number(invoice.totalAmount || 0) - Number(invoice.paidAmount || 0));
        await party.save();
      }
    }

    await StockLedger.deleteMany(
      withBranchScope(
        {
          companyId: req.user.companyId,
          referenceId: invoice._id,
          referenceType: "PURCHASE_INVOICE",
        },
        req.user.branchId,
        req.user.branchIsDefault,
      ),
    );
    await StockBatch.deleteMany(
      withBranchScope(
        {
          companyId: req.user.companyId,
          sourceType: "PURCHASE",
          sourceId: invoice._id,
        },
        req.user.branchId,
        req.user.branchIsDefault,
      ),
    );

    invoice.isDeleted = true;
    invoice.deletedAt = new Date();
    invoice.deletedBy = req.user._id || null;
    await invoice.save();

    res.json({ message: "Purchase invoice deleted successfully" });
  } catch (err) {
    res.status(400).json({ message: err.message || "Failed to delete purchase invoice" });
  }
};

exports.restorePurchaseInvoice = async (req, res) => {
  try {
    const branchId = req.user.branchId || null;
    const invoice = await PurchaseInvoice.findOne(
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

    for (const item of invoice.items || []) {
      await StockLedger.create({
        companyId: req.user.companyId,
        branchId,
        productId: item.productId,
        type: "PURCHASE",
        quantity: item.quantity,
        rate: item.rate,
        referenceType: "PURCHASE_INVOICE",
        referenceId: invoice._id,
        createdAt: invoice.invoiceDate || invoice.createdAt || new Date(),
      });
      await StockBatch.create({
        companyId: req.user.companyId,
        branchId,
        productId: item.productId,
        sourceType: "PURCHASE",
        sourceId: invoice._id,
        totalQty: Number(item.quantity || 0),
        remainingQty: Number(item.quantity || 0),
        rate: Number(item.rate || 0),
        createdAt: invoice.invoiceDate || invoice.createdAt || new Date(),
      });
      await Product.updateOne(
        { _id: item.productId, companyId: req.user.companyId },
        { $set: { lastPurchaseRate: Number(item.rate || 0) } },
      );
    }

    if (invoice.partyId) {
      const party = await Party.findById(invoice.partyId);
      if (party) {
        party.balance = Number(party.balance || 0) + (Number(invoice.totalAmount || 0) - Number(invoice.paidAmount || 0));
        await party.save();
      }
    }

    invoice.isDeleted = false;
    invoice.deletedAt = null;
    invoice.deletedBy = null;
    await invoice.save();

    res.json(toPurchaseResponse(invoice));
  } catch (err) {
    res.status(400).json({ message: err.message || "Failed to restore purchase invoice" });
  }
};
