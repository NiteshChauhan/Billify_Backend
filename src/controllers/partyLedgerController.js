const { normalizePdfLanguage } = require("../utils/pdfLanguage");
const PurchaseInvoice = require("../models/PurchaseInvoice");
const SalesInvoice = require("../models/SalesInvoice");
const Payment = require("../models/Payment");
const Party = require("../models/Party");
const ReturnEntry = require("../models/Return");
const Expense = require("../models/Expense");
const Company = require("../models/Company");
const { getDateRangeFromQuery } = require("../utils/dateRange");
const { generateLedgerPdf } = require("../services/ledgerPdfService");

const isSameDay = (dateValue) => {
  const today = new Date().toISOString().slice(0, 10);
  const d = new Date(dateValue).toISOString().slice(0, 10);
  return d === today;
};

const buildLedger = async ({ companyId, partyId, role, query, bankAccountId }) => {
  const invoiceDateQuery = query ? { invoiceDate: query } : {};
  const paymentDateQuery = query ? { paymentDate: query } : {};
  const expenseDateQuery = query ? { date: query } : {};

  const normalizedRole = String(role || "").toLowerCase();
  const includeSupplier = !normalizedRole || normalizedRole === "all" || normalizedRole === "supplier";
  const includeCustomer =
    !normalizedRole ||
    normalizedRole === "all" ||
    normalizedRole === "customer" ||
    normalizedRole === "vendor";

  const [purchases, sales, payments, returns, expenses] = await Promise.all([
    includeSupplier
      ? PurchaseInvoice.find({
          companyId,
          partyId,
          ...invoiceDateQuery,
          ...(bankAccountId ? { bankAccountId } : {}),
        }).select(
          "invoiceDate totalAmount invoiceNo paymentType bankAccountId _id",
        )
      : [],
    includeCustomer
      ? SalesInvoice.find({
          companyId,
          partyId,
          ...invoiceDateQuery,
          ...(bankAccountId ? { bankAccountId } : {}),
        }).select(
          "invoiceDate totalAmount invoiceNo paymentType bankAccountId _id",
        )
      : [],
    Payment.find({
      companyId,
      partyId,
      ...(bankAccountId ? { bankAccountId } : {}),
      ...(includeSupplier && !includeCustomer ? { invoiceType: "PURCHASE" } : {}),
      ...(includeCustomer && !includeSupplier ? { invoiceType: "SALE" } : {}),
      ...paymentDateQuery,
    }).select(
      "paymentDate amount paymentMode referenceNo paymentType invoiceType invoiceId bankAccountId adjustType _id",
    ),
    ReturnEntry.find({
      companyId,
      partyId,
      ...(query ? { returnDate: query } : {}),
      ...(includeSupplier && !includeCustomer ? { returnType: "PURCHASE_RETURN" } : {}),
      ...(includeCustomer && !includeSupplier ? { returnType: "SALE_RETURN" } : {}),
    }).select("returnDate returnType totalAmount billType billId returnNo"),
    bankAccountId
      ? Expense.find({
          companyId,
          paymentType: "bank",
          bankAccountId,
          ...expenseDateQuery,
        }).select("date title amount paymentType note bankAccountId _id")
      : [],
  ]);

  const ledger = [];
  const purchaseMap = {};
  const salesMap = {};
  const purchasePayTypeMap = {};
  const salesPayTypeMap = {};

  purchases.forEach((p) => {
    purchaseMap[String(p._id)] = p.invoiceNo || "-";
    purchasePayTypeMap[String(p._id)] = (p.paymentType || "credit").toString().toLowerCase();
    purchasePayTypeMap[`bank:${String(p._id)}`] = p.bankAccountId ? String(p.bankAccountId) : "";
  });

  sales.forEach((s) => {
    salesMap[String(s._id)] = s.invoiceNo || "-";
    salesPayTypeMap[String(s._id)] = (s.paymentType || "credit").toString().toLowerCase();
    salesPayTypeMap[`bank:${String(s._id)}`] = s.bankAccountId ? String(s.bankAccountId) : "";
  });

  purchases.forEach((p) => {
    ledger.push({
      date: p.invoiceDate,
      type: "PURCHASE",
      particulars: `Purchase Invoice ${p.invoiceNo}`,
      bill_no: p.invoiceNo || "-",
      paymentType: (p.paymentType || "credit").toString().toLowerCase(),
      bankAccountId: p.bankAccountId || null,
      partyId,
      debit: 0,
      credit: p.totalAmount,
      billId: p._id,
      billType: "PURCHASE",
      canEditBill: isSameDay(p.invoiceDate),
    });
  });

  sales.forEach((s) => {
    ledger.push({
      date: s.invoiceDate,
      type: "SALE",
      particulars: `Sales Invoice ${s.invoiceNo}`,
      bill_no: s.invoiceNo || "-",
      paymentType: (s.paymentType || "credit").toString().toLowerCase(),
      bankAccountId: s.bankAccountId || null,
      partyId,
      debit: s.totalAmount,
      credit: 0,
      billId: s._id,
      billType: "SALE",
      canEditBill: isSameDay(s.invoiceDate),
    });
  });

  payments.forEach((p) => {
    const isReceived = p.paymentType === "RECEIVED" || p.invoiceType === "SALE";
    const invoiceNo =
      p.invoiceType === "OPENING"
        ? "-"
        : p.invoiceType === "PURCHASE"
        ? purchaseMap[String(p.invoiceId)] || "-"
        : salesMap[String(p.invoiceId)] || "-";
    ledger.push({
      date: p.paymentDate,
      type: "PAYMENT",
      particulars:
        p.adjustType === "opening"
          ? "Payment (Opening)"
          : `Payment (${invoiceNo !== "-" ? invoiceNo : p.paymentMode})`,
      bill_no: invoiceNo,
      paymentType: String(p.paymentMode || "").toUpperCase() === "CASH" ? "cash" : "bank",
      bankAccountId: p.bankAccountId || null,
      partyId,
      debit: isReceived ? 0 : p.amount, // paid
      credit: isReceived ? p.amount : 0, // received
      billId: p.invoiceId || null,
      billType: p.invoiceType,
      canEditBill: false,
    });
  });

  returns.forEach((r) => {
    const isSaleReturn = r.returnType === "SALE_RETURN";
    const returnBillNo = r.returnNo || `RET-${String(r._id).slice(-6).toUpperCase()}`;
    const mappedPaymentType =
      r.billType === "PURCHASE"
        ? purchasePayTypeMap[String(r.billId)] || "credit"
        : salesPayTypeMap[String(r.billId)] || "credit";
    const mappedBankAccountId =
      mappedPaymentType === "bank"
        ? r.billType === "PURCHASE"
          ? purchasePayTypeMap[`bank:${String(r.billId)}`] || null
          : salesPayTypeMap[`bank:${String(r.billId)}`] || null
        : null;
    ledger.push({
      date: r.returnDate,
      type: r.returnType,
      particulars: `${isSaleReturn ? "Sale Return" : "Purchase Return"} ${returnBillNo}`,
      bill_no: returnBillNo,
      paymentType: mappedPaymentType,
      bankAccountId: mappedBankAccountId,
      partyId,
      debit: isSaleReturn ? 0 : r.totalAmount, // purchase return
      credit: isSaleReturn ? r.totalAmount : 0, // sale return
      billId: r.billId,
      billType: r.billType,
      canEditBill: false,
    });
  });

  expenses.forEach((expense) => {
    ledger.push({
      date: expense.date,
      type: "EXPENSE",
      particulars: `Expense ${expense.title}`,
      bill_no: "-",
      paymentType: String(expense.paymentType || "cash").toLowerCase(),
      bankAccountId: expense.bankAccountId || null,
      partyId: null,
      debit: Number(expense.amount || 0),
      credit: 0,
      billId: expense._id,
      billType: "EXPENSE",
      canEditBill: false,
    });
  });

  ledger.sort((a, b) => new Date(a.date) - new Date(b.date));
  return ledger;
};

const openingBalanceEffect = (party) => {
  const openingBalance = Number(party?.openingBalance || 0);
  if (!(openingBalance > 0)) return 0;
  return String(party?.openingType || "receivable").toLowerCase() === "payable"
    ? -openingBalance
    : openingBalance;
};

exports.getPartyLedger = async (req, res) => {
  try {
    const { partyId } = req.params;
    const companyId = req.user.companyId;
    const rawRole = req.query.role;
    const filterType = String(req.query.type || "all").toLowerCase();
    const role =
      filterType === "customer" || filterType === "supplier"
        ? filterType
        : rawRole;
    const bankAccountId = req.query.bankAccountId || "";

    const party = await Party.findOne({ _id: partyId, companyId });
    if (!party) {
      return res.status(404).json({ message: "Party not found" });
    }

    const range = getDateRangeFromQuery(req.query);
    const query = range
      ? { $gte: range.fromDate, $lte: range.toDate }
      : null;

    let ledger = await buildLedger({
      companyId,
      partyId,
      role,
      query,
      bankAccountId,
    });

    if (filterType === "cash" || filterType === "bank" || filterType === "credit") {
      ledger = ledger.filter((e) => e.paymentType === filterType);
      if (filterType === "bank" && bankAccountId) {
        ledger = ledger.filter((e) => String(e.bankAccountId || "") === String(bankAccountId));
      }
    } else if (filterType === "party") {
      ledger = ledger.filter((e) => !!e.partyId);
    }

    const openingEffect = openingBalanceEffect(party);
    if (Number(party.openingBalance || 0) > 0) {
      ledger.unshift({
        date: party.createdAt,
        type: "OPENING",
        particulars: "Opening Balance",
        bill_no: "-",
        paymentType: "opening",
        bankAccountId: null,
        partyId,
        debit: openingEffect > 0 ? Math.abs(openingEffect) : 0,
        credit: openingEffect < 0 ? Math.abs(openingEffect) : 0,
        billId: null,
        billType: "OPENING",
        canEditBill: false,
      });
    }

    let balance = 0;
    ledger = ledger.map((entry) => {
      balance = balance + entry.debit - entry.credit;
      return { ...entry, balance };
    });

    res.json({
      party,
      ledger,
      closingBalance: balance,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.exportPartyLedgerPdf = async (req, res) => {
  try {
    const { partyId } = req.params;
    const companyId = req.user.companyId;
    const rawRole = req.query.role;
    const filterType = String(req.query.type || "all").toLowerCase();
    const role =
      filterType === "customer" || filterType === "supplier"
        ? filterType
        : rawRole;
    const bankAccountId = req.query.bankAccountId || "";

    const party = await Party.findOne({ _id: partyId, companyId });
    if (!party) {
      return res.status(404).json({ message: "Party not found" });
    }

    const range = getDateRangeFromQuery(req.query);
    const query = range
      ? { $gte: range.fromDate, $lte: range.toDate }
      : null;

    let ledger = await buildLedger({ companyId, partyId, role, query, bankAccountId });

    if (filterType === "cash" || filterType === "bank" || filterType === "credit") {
      ledger = ledger.filter((e) => e.paymentType === filterType);
      if (filterType === "bank" && bankAccountId) {
        ledger = ledger.filter((e) => String(e.bankAccountId || "") === String(bankAccountId));
      }
    } else if (filterType === "party") {
      ledger = ledger.filter((e) => !!e.partyId);
    }
    const openingEffect = openingBalanceEffect(party);
    if (Number(party.openingBalance || 0) > 0) {
      ledger.unshift({
        date: party.createdAt,
        type: "OPENING",
        particulars: "Opening Balance",
        bill_no: "-",
        paymentType: "opening",
        bankAccountId: null,
        partyId,
        debit: openingEffect > 0 ? Math.abs(openingEffect) : 0,
        credit: openingEffect < 0 ? Math.abs(openingEffect) : 0,
        billId: null,
        billType: "OPENING",
        canEditBill: false,
      });
    }
    let balance = 0;
    ledger = ledger.map((entry) => {
      balance = balance + entry.debit - entry.credit;
      return { ...entry, balance };
    });

    const company = await Company.findById(companyId).select("pdfLanguage");
    const language = normalizePdfLanguage(req.query.language || company?.pdfLanguage);
    await generateLedgerPdf(res, {
      party,
      ledger,
      balance,
      filterType,
      language,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
