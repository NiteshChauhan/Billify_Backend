const PurchaseInvoice = require("../models/PurchaseInvoice");
const StockLedger = require("../models/StockLedger");
const Party = require("../models/Party");
const Payment = require("../models/Payment");
const BankAccount = require("../models/BankAccount");
const Product = require("../models/Product");
const { getDateRangeFromQuery } = require("../utils/dateRange");

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
        _id: partyId,
        companyId: req.user.companyId,
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
        productId: item.productId,
        type: "PURCHASE",
        quantity: item.quantity,
        rate: item.rate,
        referenceType: "PURCHASE_INVOICE",
        referenceId: invoice._id,
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
  const query = { companyId: req.user.companyId };
  const dateRange = getDateRangeFromQuery(req.query);
  if (dateRange) {
    query.invoiceDate = { $gte: dateRange.fromDate, $lte: dateRange.toDate };
  }
  if (req.query.paymentType) {
    query.paymentType = String(req.query.paymentType).toLowerCase();
  }

  const data = await PurchaseInvoice.find(query)
    .populate("partyId", "name")
    .sort({ createdAt: -1 });

  res.json(data.map(toPurchaseResponse));
};

/* ================= GET PURCHASE BY ID ================= */
exports.getPurchaseById = async (req, res) => {
  const invoice = await PurchaseInvoice.findById(req.params.id)
    .populate("partyId", "name")
    .populate("items.productId", "name");

  res.json(toPurchaseResponse(invoice));
};

/* ================= UPDATE PURCHASE INVOICE ================= */
exports.updatePurchaseInvoice = async (req, res) => {
  try {
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

    const invoice = await PurchaseInvoice.findById(id);

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
        _id: partyId,
        companyId: req.user.companyId,
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
        productId: item.productId,
        type: "PURCHASE",
        quantity: item.quantity,
        rate: item.rate,
        referenceType: "PURCHASE_INVOICE",
        referenceId: invoice._id,
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
