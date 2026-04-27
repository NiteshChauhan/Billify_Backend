const Payment = require("../models/Payment");
const Party = require("../models/Party");
const PurchaseInvoice = require("../models/PurchaseInvoice");
const SalesInvoice = require("../models/SalesInvoice");
const BankAccount = require("../models/BankAccount");
const ReturnEntry = require("../models/Return");
const { getDateRangeFromQuery } = require("../utils/dateRange");

const getRemainingOpeningBalance = async ({ party, companyId, branchId }) => {
  const openingBalance = Number(party?.openingBalance || 0);
  if (!(openingBalance > 0)) {
    return 0;
  }

  const storedRemaining = Number(party?.remainingOpeningBalance ?? openingBalance);
  if (storedRemaining > 0) {
    return storedRemaining;
  }

  const openingPayments = await Payment.aggregate([
    {
      $match: {
        companyId: party.companyId || companyId,
        branchId: branchId || null,
        partyId: party._id,
        $or: [{ adjustType: "opening" }, { invoiceType: "OPENING" }],
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$amount" },
      },
    },
  ]);

  const paidAgainstOpening = Number(openingPayments[0]?.total || 0);
  return Math.max(0, openingBalance - paidAgainstOpening);
};

const getPendingAmount = async ({ invoice, invoiceType, companyId, branchId }) => {
  const normalizedType = String(invoiceType || "").toUpperCase();
  const totalAmount = Number(invoice?.totalAmount || 0);

  const [paymentTotals, returnTotals] = await Promise.all([
    Payment.aggregate([
      {
        $match: {
          companyId,
          branchId: branchId || null,
          partyId: invoice.partyId,
          invoiceType: normalizedType,
          invoiceId: invoice._id,
          adjustType: { $ne: "opening" },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
        },
      },
    ]),
    ReturnEntry.aggregate([
      {
        $match: {
          companyId,
          branchId: branchId || null,
          partyId: invoice.partyId,
          billType: normalizedType,
          billId: invoice._id,
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$totalAmount" },
        },
      },
    ]),
  ]);

  const paidAmount = Number(paymentTotals[0]?.total ?? invoice?.paidAmount ?? 0);
  const returnAmount = Number(returnTotals[0]?.total || 0);
  return Math.max(0, totalAmount - paidAmount - returnAmount);
};

const updateInvoiceAmounts = async (invoice) => {
  invoice.pendingAmount = Math.max(0, Number(invoice.totalAmount || 0) - Number(invoice.paidAmount || 0));
  invoice.status =
    invoice.paidAmount >= invoice.totalAmount
      ? "PAID"
      : invoice.paidAmount > 0
        ? "PARTIAL"
        : "DUE";
  await invoice.save();
};

const reversePaymentImpact = async ({ payment, companyId, branchId }) => {
  const party = payment.partyId
    ? await Party.findOne({ _id: payment.partyId, companyId })
    : null;

  if (String(payment.adjustType || "").toLowerCase() === "opening" || payment.invoiceType === "OPENING") {
    if (party) {
      const openingBalance = Number(party.openingBalance || 0);
      const currentRemaining = Number(party.remainingOpeningBalance ?? openingBalance);
      party.remainingOpeningBalance = Math.min(
        openingBalance,
        currentRemaining + Number(payment.amount || 0),
      );
      party.balance = Number(party.balance || 0) + Number(payment.amount || 0);
      await party.save();
    }
    return;
  }

  const InvoiceModel =
    payment.invoiceType === "SALE" ? SalesInvoice : payment.invoiceType === "PURCHASE" ? PurchaseInvoice : null;
  if (!InvoiceModel) return;

  const invoice = await InvoiceModel.findOne({
    _id: payment.invoiceId,
    companyId,
    branchId: branchId || null,
  });

  if (invoice) {
    invoice.paidAmount = Math.max(0, Number(invoice.paidAmount || 0) - Number(payment.amount || 0));
    await updateInvoiceAmounts(invoice);
  }

  if (party) {
    party.balance = Number(party.balance || 0) + Number(payment.amount || 0);
    await party.save();
  }
};

const restorePaymentImpact = async ({ payment, companyId, branchId }) => {
  const party = payment.partyId
    ? await Party.findOne({ _id: payment.partyId, companyId })
    : null;

  if (String(payment.adjustType || "").toLowerCase() === "opening" || payment.invoiceType === "OPENING") {
    if (party) {
      const remainingOpening = await getRemainingOpeningBalance({ party, companyId, branchId });
      if (Number(payment.amount || 0) > remainingOpening) {
        throw new Error("Cannot restore payment because opening balance is already settled");
      }
      party.remainingOpeningBalance = Math.max(0, remainingOpening - Number(payment.amount || 0));
      party.balance = Math.max(0, Number(party.balance || 0) - Number(payment.amount || 0));
      await party.save();
    }
    return;
  }

  const InvoiceModel =
    payment.invoiceType === "SALE" ? SalesInvoice : payment.invoiceType === "PURCHASE" ? PurchaseInvoice : null;
  if (!InvoiceModel) return;

  const invoice = await InvoiceModel.findOne({
    _id: payment.invoiceId,
    companyId,
    branchId: branchId || null,
  });

  if (!invoice) {
    throw new Error("Linked invoice not found for restore");
  }

  const pendingAmount = await getPendingAmount({
    invoice,
    invoiceType: payment.invoiceType,
    companyId,
    branchId,
  });

  if (Number(payment.amount || 0) > pendingAmount) {
    throw new Error("Cannot restore payment because invoice is already settled");
  }

  invoice.paidAmount = Number(invoice.paidAmount || 0) + Number(payment.amount || 0);
  await updateInvoiceAmounts(invoice);

  if (party) {
    party.balance = Math.max(0, Number(party.balance || 0) - Number(payment.amount || 0));
    await party.save();
  }
};

const getBankAccountId = async ({ paymentMode, bodyBankAccountId, companyId }) => {
  if (String(paymentMode || "").toUpperCase() !== "BANK") {
    return null;
  }
  if (!bodyBankAccountId) {
    throw new Error("bankAccountId is required for bank payments");
  }
  const bankAccount = await BankAccount.findOne({
    _id: bodyBankAccountId,
    companyId,
  }).select("_id");
  if (!bankAccount) {
    throw new Error("Invalid bank account");
  }
  return bankAccount._id;
};

const createLegacyPayment = async ({ req, bankAccountId, normalizedAdjustType }) => {
  const {
    partyId: bodyPartyId,
    invoiceType,
    invoiceId,
    amount,
    paymentMode,
    referenceNo,
    remarks,
  } = req.body;

  if (invoiceType === "PURCHASE") {
    const invoice = await PurchaseInvoice.findOne({
      _id: invoiceId,
      companyId: req.user.companyId,
      branchId: req.user.branchId || null,
    });

    if (!invoice) {
      throw new Error("Purchase invoice not found");
    }

    const partyId = bodyPartyId || invoice.partyId?.toString();
    if (!partyId) {
      throw new Error("partyId is required");
    }

    const party = await Party.findById(partyId);
    if (!party) {
      throw new Error("Party not found");
    }

    if (normalizedAdjustType === "opening") {
      const remainingOpening = await getRemainingOpeningBalance({
        party,
        companyId: req.user.companyId,
        branchId: req.user.branchId || null,
      });
      if (!(remainingOpening > 0)) {
        throw new Error("Opening balance is not available for adjustment");
      }
      if (amount > remainingOpening) {
        throw new Error(`Payment exceeds opening balance (Rs ${remainingOpening})`);
      }

      const payment = await Payment.create({
        companyId: req.user.companyId,
        branchId: req.user.branchId || null,
        partyId,
        invoiceType: "OPENING",
        invoiceId: null,
        paymentType: "PAID",
        amount,
        paymentMode,
        bankAccountId,
        adjustType: "opening",
        referenceNo,
        remarks,
      });

      party.remainingOpeningBalance = remainingOpening - Number(amount || 0);
      party.balance = Math.max(0, Number(party.balance || 0) - Number(amount || 0));
      await party.save();

      return { payment, invoice, party };
    }

    const balance = await getPendingAmount({
      invoice,
      invoiceType: "PURCHASE",
      companyId: req.user.companyId,
      branchId: req.user.branchId || null,
    });
    if (amount > balance) {
      throw new Error(`Payment exceeds outstanding amount (Rs ${balance})`);
    }

    const payment = await Payment.create({
      companyId: req.user.companyId,
      branchId: req.user.branchId || null,
      partyId,
      invoiceType,
      invoiceId,
      paymentType: "PAID",
      amount,
      paymentMode,
      bankAccountId,
      adjustType: "bill",
      referenceNo,
      remarks,
    });

    party.balance = Number(party.balance || 0) - Number(amount || 0);
    await party.save();

    invoice.paidAmount = Number(invoice.paidAmount || 0) + Number(amount || 0);
    await updateInvoiceAmounts(invoice);

    return { payment, invoice, party };
  }

  if (invoiceType === "SALE") {
    const invoice = await SalesInvoice.findOne({
      _id: invoiceId,
      companyId: req.user.companyId,
      branchId: req.user.branchId || null,
    });

    if (!invoice) {
      throw new Error("Sales invoice not found");
    }

    const partyId = bodyPartyId || invoice.partyId?.toString();
    if (!partyId) {
      throw new Error("partyId is required");
    }

    const party = await Party.findById(partyId);
    if (!party) {
      throw new Error("Party not found");
    }

    if (normalizedAdjustType === "opening") {
      const remainingOpening = await getRemainingOpeningBalance({
        party,
        companyId: req.user.companyId,
        branchId: req.user.branchId || null,
      });
      if (!(remainingOpening > 0)) {
        throw new Error("Opening balance is not available for adjustment");
      }
      if (amount > remainingOpening) {
        throw new Error(`Payment exceeds opening balance (Rs ${remainingOpening})`);
      }

      const payment = await Payment.create({
        companyId: req.user.companyId,
        branchId: req.user.branchId || null,
        partyId,
        invoiceType: "OPENING",
        invoiceId: null,
        paymentType: "RECEIVED",
        amount,
        paymentMode,
        bankAccountId,
        adjustType: "opening",
        referenceNo,
        remarks,
      });

      party.remainingOpeningBalance = remainingOpening - Number(amount || 0);
      party.balance = Math.max(0, Number(party.balance || 0) - Number(amount || 0));
      await party.save();

      return { payment, invoice, party };
    }

    const balance = await getPendingAmount({
      invoice,
      invoiceType: "SALE",
      companyId: req.user.companyId,
      branchId: req.user.branchId || null,
    });
    if (amount > balance) {
      throw new Error(`Payment exceeds outstanding amount (Rs ${balance})`);
    }

    const payment = await Payment.create({
      companyId: req.user.companyId,
      branchId: req.user.branchId || null,
      partyId,
      invoiceType,
      invoiceId,
      paymentType: "RECEIVED",
      amount,
      paymentMode,
      bankAccountId,
      adjustType: "bill",
      referenceNo,
      remarks,
    });

    party.balance = Number(party.balance || 0) - Number(amount || 0);
    await party.save();

    invoice.paidAmount = Number(invoice.paidAmount || 0) + Number(amount || 0);
    await updateInvoiceAmounts(invoice);

    return { payment, invoice, party };
  }

  throw new Error("Invalid invoice type");
};

const createAllocatedPayments = async ({ req, bankAccountId }) => {
  const {
    partyId,
    totalAmount,
    allocations,
    paymentMode,
    referenceNo,
    remarks,
  } = req.body;

  if (!partyId) {
    throw new Error("partyId is required");
  }
  if (!Array.isArray(allocations) || !allocations.length) {
    throw new Error("allocations are required");
  }

  const party = await Party.findOne({ _id: partyId, companyId: req.user.companyId });
  if (!party) {
    throw new Error("Party not found");
  }

  const normalizedTotalAmount = Number(totalAmount || 0);
  const normalizedAllocations = allocations.map((allocation) => ({
    type: String(allocation.type || "").toLowerCase(),
    refId: allocation.refId || null,
    amount: Number(allocation.amount || 0),
  }));

  if (!(normalizedTotalAmount > 0)) {
    throw new Error("totalAmount must be greater than 0");
  }

  const allocationSum = normalizedAllocations.reduce((sum, allocation) => sum + allocation.amount, 0);
  if (Math.abs(allocationSum - normalizedTotalAmount) > 0.001) {
    throw new Error("sum(allocations) must equal totalAmount");
  }

  const createdPayments = [];
  const updatedInvoices = [];

  for (const allocation of normalizedAllocations) {
    if (!(allocation.amount > 0)) {
      throw new Error("Allocation amount must be greater than 0");
    }

    if (allocation.type === "opening") {
      const remainingOpening = await getRemainingOpeningBalance({
        party,
        companyId: req.user.companyId,
        branchId: req.user.branchId || null,
      });
      if (!(remainingOpening > 0)) {
        throw new Error("Opening balance is not available for adjustment");
      }
      if (allocation.amount > remainingOpening) {
        throw new Error(`Opening allocation exceeds pending amount (Rs ${remainingOpening})`);
      }

      const paymentType = String(party.openingType || "receivable") === "payable" ? "PAID" : "RECEIVED";
      const payment = await Payment.create({
        companyId: req.user.companyId,
        branchId: req.user.branchId || null,
        partyId: party._id,
        invoiceType: "OPENING",
        invoiceId: null,
        paymentType,
        amount: allocation.amount,
        paymentMode,
        bankAccountId,
        adjustType: "opening",
        referenceNo,
        remarks,
      });

      party.remainingOpeningBalance = remainingOpening - allocation.amount;
      party.balance = Math.max(0, Number(party.balance || 0) - allocation.amount);
      createdPayments.push(payment);
      continue;
    }

    if (!["sale", "purchase"].includes(allocation.type)) {
      throw new Error("Allocation type must be opening, sale, or purchase");
    }
    if (!allocation.refId) {
      throw new Error("Allocation refId is required");
    }

    const InvoiceModel = allocation.type === "sale" ? SalesInvoice : PurchaseInvoice;
    const invoice = await InvoiceModel.findOne({
      _id: allocation.refId,
      companyId: req.user.companyId,
      branchId: req.user.branchId || null,
      partyId: party._id,
    });

    if (!invoice) {
      throw new Error(`${allocation.type} reference not found`);
    }

    const pendingAmount = await getPendingAmount({
      invoice,
      invoiceType: allocation.type === "sale" ? "SALE" : "PURCHASE",
      companyId: req.user.companyId,
      branchId: req.user.branchId || null,
    });
    if (allocation.amount > pendingAmount) {
      throw new Error(`Allocation exceeds pending amount for ${invoice.invoiceNo || allocation.type}`);
    }

    const payment = await Payment.create({
      companyId: req.user.companyId,
      branchId: req.user.branchId || null,
      partyId: party._id,
      invoiceType: allocation.type === "sale" ? "SALE" : "PURCHASE",
      invoiceId: invoice._id,
      paymentType: allocation.type === "sale" ? "RECEIVED" : "PAID",
      amount: allocation.amount,
      paymentMode,
      bankAccountId,
      adjustType: "bill",
      referenceNo,
      remarks,
    });

    invoice.paidAmount = Number(invoice.paidAmount || 0) + allocation.amount;
    await updateInvoiceAmounts(invoice);
    party.balance = Math.max(0, Number(party.balance || 0) - allocation.amount);

    createdPayments.push(payment);
    updatedInvoices.push(invoice);
  }

  await party.save();

  return {
    payments: createdPayments,
    party,
    invoices: updatedInvoices,
  };
};

/* ================= CREATE PAYMENT ================= */
exports.createPayment = async (req, res) => {
  try {
    const {
      amount,
      paymentMode,
      bankAccountId: bodyBankAccountId,
      allocations,
      adjustType = "bill",
    } = req.body;

    const hasAllocations = Array.isArray(allocations) && allocations.length > 0;
    if (!hasAllocations && (!amount || amount <= 0)) {
      return res.status(400).json({ error: "Invalid payment amount" });
    }

    const normalizedAdjustType = String(adjustType || "bill").toLowerCase();
    if (!['opening', 'bill'].includes(normalizedAdjustType)) {
      return res.status(400).json({ error: "adjustType must be opening or bill" });
    }

    const bankAccountId = await getBankAccountId({
      paymentMode,
      bodyBankAccountId,
      companyId: req.user.companyId,
    });

    if (hasAllocations) {
      const result = await createAllocatedPayments({ req, bankAccountId });
      return res.json(result);
    }

    const result = await createLegacyPayment({ req, bankAccountId, normalizedAdjustType });
    return res.json(result);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
};

/* ================= GET PAYMENTS BY INVOICE ================= */
exports.getPaymentsByInvoice = async (req, res) => {
  const status = String(req.query.status || "active").toLowerCase();
  const query = {
    companyId: req.user.companyId,
    branchId: req.user.branchId || null,
    invoiceId: req.params.invoiceId,
    ...(status === "deleted" ? { isDeleted: true } : {}),
  };
  const withDeleted = status === "deleted" || status === "all";
  const dateRange = getDateRangeFromQuery(req.query);
  if (dateRange) {
    query.paymentDate = { $gte: dateRange.fromDate, $lte: dateRange.toDate };
  }

  const payments = await Payment.find(query)
    .setOptions({ withDeleted })
    .sort({ createdAt: 1 });

  res.json(payments);
};

/* ================= GET PAYMENTS LIST ================= */
exports.getPayments = async (req, res) => {
  const status = String(req.query.status || "active").toLowerCase();
  const query = {
    companyId: req.user.companyId,
    branchId: req.user.branchId || null,
    ...(status === "deleted" ? { isDeleted: true } : {}),
  };
  const withDeleted = status === "deleted" || status === "all";
  const dateRange = getDateRangeFromQuery(req.query);
  if (dateRange) {
    query.paymentDate = { $gte: dateRange.fromDate, $lte: dateRange.toDate };
  }

  const payments = await Payment.find(query)
    .setOptions({ withDeleted })
    .populate("partyId", "name")
    .sort({ paymentDate: -1, createdAt: -1 });

  res.json(payments);
};

exports.deletePayment = async (req, res) => {
  try {
    const payment = await Payment.findOne({
      _id: req.params.id,
      companyId: req.user.companyId,
      branchId: req.user.branchId || null,
    });

    if (!payment) {
      return res.status(404).json({ error: "Payment not found" });
    }

    await reversePaymentImpact({
      payment,
      companyId: req.user.companyId,
      branchId: req.user.branchId || null,
    });

    payment.isDeleted = true;
    payment.deletedAt = new Date();
    payment.deletedBy = req.user._id || null;
    await payment.save();

    res.json({ message: "Payment deleted successfully" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.restorePayment = async (req, res) => {
  try {
    const payment = await Payment.findOne({
      _id: req.params.id,
      companyId: req.user.companyId,
      branchId: req.user.branchId || null,
      isDeleted: true,
    }).setOptions({ withDeleted: true });

    if (!payment) {
      return res.status(404).json({ error: "Deleted payment not found" });
    }

    await restorePaymentImpact({
      payment,
      companyId: req.user.companyId,
      branchId: req.user.branchId || null,
    });

    payment.isDeleted = false;
    payment.deletedAt = null;
    payment.deletedBy = null;
    await payment.save();

    res.json({ message: "Payment restored successfully" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
