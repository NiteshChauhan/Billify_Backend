const StockLedger = require("../models/StockLedger");
const Product = require("../models/Product");
const Party = require("../models/Party");
const PurchaseInvoice = require("../models/PurchaseInvoice");
const SalesInvoice = require("../models/SalesInvoice");
const Payment = require("../models/Payment");
const CompanyBalance = require("../models/CompanyBalance");
const Expense = require("../models/Expense");
const LoanEntry = require("../models/LoanEntry");
const StockBatch = require("../models/StockBatch");
const ReturnEntry = require("../models/Return");
const { getDateRangeFromQuery } = require("../utils/dateRange");
const { getProfitSummary } = require("../utils/profitUtils");
const { previewConsumeBatches } = require("../utils/stockUtils");

const startOfDay = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfDay = (value) => {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
};

const addDays = (value, days) => {
  const date = startOfDay(value);
  date.setDate(date.getDate() + days);
  return date;
};

const toDayKey = (value) => startOfDay(value).toISOString().slice(0, 10);

const getInvoicePaymentTypeQuery = (paymentTypeFilter) =>
  paymentTypeFilter === "all" ? { $in: ["cash", "bank"] } : paymentTypeFilter;

const getPaymentModeQuery = (paymentTypeFilter) =>
  paymentTypeFilter === "all"
    ? { $in: ["CASH", "UPI", "BANK", "CHEQUE"] }
    : paymentTypeFilter === "cash"
    ? "CASH"
    : { $in: ["UPI", "BANK", "CHEQUE"] };

const getDayBookPaymentType = (paymentMode) =>
  String(paymentMode || "").toUpperCase() === "CASH" ? "cash" : "bank";

const sumAmount = (rows = [], field = "amount") =>
  rows.reduce((sum, row) => sum + Number(row?.[field] || 0), 0);

const loadPaymentInvoiceMeta = async (companyId, payments = []) => {
  const saleIds = [...new Set(
    payments
      .filter((payment) => payment.invoiceType === "SALE" && payment.invoiceId)
      .map((payment) => String(payment.invoiceId)),
  )];
  const purchaseIds = [...new Set(
    payments
      .filter((payment) => payment.invoiceType === "PURCHASE" && payment.invoiceId)
      .map((payment) => String(payment.invoiceId)),
  )];

  const [sales, purchases] = await Promise.all([
    saleIds.length
      ? SalesInvoice.find({ companyId, _id: { $in: saleIds } }).select("_id invoiceDate invoiceNo")
      : [],
    purchaseIds.length
      ? PurchaseInvoice.find({ companyId, _id: { $in: purchaseIds } }).select("_id invoiceDate invoiceNo")
      : [],
  ]);

  const saleMap = new Map(sales.map((invoice) => [String(invoice._id), invoice]));
  const purchaseMap = new Map(purchases.map((invoice) => [String(invoice._id), invoice]));

  return payments.map((payment) => {
    const linkedInvoice =
      payment.invoiceType === "SALE"
        ? saleMap.get(String(payment.invoiceId))
        : payment.invoiceType === "PURCHASE"
        ? purchaseMap.get(String(payment.invoiceId))
        : null;

    return {
      ...payment,
      linkedInvoiceDate: linkedInvoice?.invoiceDate || null,
      linkedInvoiceNo: linkedInvoice?.invoiceNo || "",
    };
  });
};

const isOpeningAdjustmentPayment = (payment) =>
  String(payment.adjustType || "").toLowerCase() === "opening" ||
  String(payment.invoiceType || "").toUpperCase() === "OPENING";

const getInvoiceSettlementModes = (invoice, payments = []) => {
  const invoiceDay = startOfDay(invoice.invoiceDate).getTime();
  return payments
    .filter(
      (payment) =>
        String(payment.adjustType || "").toLowerCase() !== "opening" &&
        String(payment.invoiceId || "") === String(invoice._id) &&
        startOfDay(payment.paymentDate).getTime() === invoiceDay,
    )
    .map((payment) => String(payment.paymentMode || "").toUpperCase());
};

const getInvoiceDayBookPaymentType = (invoice, settlementModes = []) => {
  const invoicePaymentType = String(invoice.paymentType || "credit").toLowerCase();
  if (invoicePaymentType === "cash" || invoicePaymentType === "bank") {
    return invoicePaymentType;
  }
  if (!settlementModes.length) {
    return null;
  }
  const hasCash = settlementModes.includes("CASH");
  const hasNonCash = settlementModes.some((mode) => mode !== "CASH");
  if (hasCash && !hasNonCash) return "cash";
  if (!hasCash && hasNonCash) return "bank";
  return "bank";
};

const shouldIncludeInvoiceInDayBook = (invoice, paymentTypeFilter, settlementModes = []) => {
  const invoiceDayBookPaymentType = getInvoiceDayBookPaymentType(invoice, settlementModes);
  if (!invoiceDayBookPaymentType) {
    return false;
  }
  if (paymentTypeFilter !== "all" && invoiceDayBookPaymentType !== paymentTypeFilter) {
    return false;
  }
  if (String(invoice.paymentType || "").toLowerCase() === "credit") {
    return settlementModes.length > 0;
  }
  return true;
};

const isPreviousDueSettlementPayment = (payment) => {
  if (isOpeningAdjustmentPayment(payment)) {
    return true;
  }
  if (!payment.linkedInvoiceDate) {
    return true;
  }
  return startOfDay(payment.linkedInvoiceDate).getTime() < startOfDay(payment.paymentDate).getTime();
};

const fetchDayBookTransactions = async ({
  companyId,
  fromDate,
  toDate,
  paymentTypeFilter,
  includeRows = true,
}) => {
  const invoiceQuery = {
    companyId,
    invoiceDate: { $gte: fromDate, $lte: toDate },
  };
  const paymentQuery = {
    companyId,
    paymentDate: { $gte: fromDate, $lte: toDate },
    paymentMode: getPaymentModeQuery(paymentTypeFilter),
  };
  const expenseQuery = {
    companyId,
    date: { $gte: fromDate, $lte: toDate },
    ...(paymentTypeFilter === "all" ? {} : { paymentType: paymentTypeFilter }),
  };
  const loanQuery = {
    companyId,
    date: { $gte: fromDate, $lte: toDate },
    ...(paymentTypeFilter === "all" ? {} : { paymentType: paymentTypeFilter }),
  };

  const [rawSales, rawPurchases, rawPayments, expenses, loans, returns] = await Promise.all([
    SalesInvoice.find(invoiceQuery)
      .populate("partyId", "name")
      .populate("bankAccountId", "accountName")
      .sort({ invoiceDate: 1, createdAt: 1 }),
    PurchaseInvoice.find(invoiceQuery)
      .populate("partyId", "name")
      .populate("bankAccountId", "accountName")
      .sort({ invoiceDate: 1, createdAt: 1 }),
    Payment.find(paymentQuery)
      .populate("partyId", "name")
      .populate("bankAccountId", "accountName")
      .sort({ paymentDate: 1, createdAt: 1 })
      .lean(),
    Expense.find(expenseQuery)
      .populate("bankAccountId", "accountName")
      .sort({ date: 1, createdAt: 1 }),
    LoanEntry.find(loanQuery)
      .populate("bankAccountId", "accountName")
      .sort({ date: 1, createdAt: 1 }),
    ReturnEntry.find({
      companyId,
      returnDate: { $gte: fromDate, $lte: toDate },
    })
      .populate("partyId", "name")
      .sort({ returnDate: 1, createdAt: 1 }),
  ]);

  const payments = (await loadPaymentInvoiceMeta(companyId, rawPayments))
    .filter((payment) => isPreviousDueSettlementPayment(payment));

  const sales = rawSales.filter((invoice) =>
    shouldIncludeInvoiceInDayBook(invoice, paymentTypeFilter, getInvoiceSettlementModes(invoice, rawPayments)),
  );
  const purchases = rawPurchases.filter((invoice) =>
    shouldIncludeInvoiceInDayBook(invoice, paymentTypeFilter, getInvoiceSettlementModes(invoice, rawPayments)),
  );

  const salesRows = sales.map((invoice) => ({
    date: invoice.invoiceDate,
    type: "sale",
    partyName: invoice.partyId?.name || "Cash",
    paymentType: getInvoiceDayBookPaymentType(invoice, getInvoiceSettlementModes(invoice, rawPayments)),
    amount: Number(invoice.totalAmount || 0),
    billId: invoice._id,
    bankAccountId: invoice.bankAccountId?._id || invoice.bankAccountId || null,
    bankAccountName: invoice.bankAccountId?.accountName || "-",
    invoiceNo: invoice.invoiceNo || "-",
  }));

  const purchaseRows = purchases.map((invoice) => ({
    date: invoice.invoiceDate,
    type: "purchase",
    partyName: invoice.partyId?.name || "Cash",
    paymentType: getInvoiceDayBookPaymentType(invoice, getInvoiceSettlementModes(invoice, rawPayments)),
    amount: Number(invoice.totalAmount || 0),
    billId: invoice._id,
    bankAccountId: invoice.bankAccountId?._id || invoice.bankAccountId || null,
    bankAccountName: invoice.bankAccountId?.accountName || "-",
    invoiceNo: invoice.invoiceNo || "-",
  }));

  const paymentRows = payments.map((payment) => ({
    date: payment.paymentDate,
    type: "payment",
    partyName: payment.partyId?.name || "Cash",
    paymentType: getDayBookPaymentType(payment.paymentMode),
    amount: Number(payment.amount || 0),
    billId: payment.invoiceId || payment._id,
    paymentId: payment._id,
    paymentDirection: String(payment.paymentType || "RECEIVED").toLowerCase(),
    invoiceType: payment.invoiceType || "",
    referenceNo: payment.referenceNo || "",
    bankAccountId: payment.bankAccountId?._id || payment.bankAccountId || null,
    note: payment.remarks || "",
    bankAccountName: payment.bankAccountId?.accountName || "-",
    invoiceNo: payment.linkedInvoiceNo || "-",
    adjustType: payment.adjustType || "bill",
  }));

  const expenseRows = expenses.map((expense) => ({
    date: expense.date,
    type: "expense",
    partyName: String(expense.title || "").trim() || "Expense",
    paymentType: String(expense.paymentType || "cash").toLowerCase(),
    amount: Number(expense.amount || 0),
    billId: expense._id,
    bankAccountId: expense.bankAccountId?._id || expense.bankAccountId || null,
    note: expense.note || "",
    bankAccountName: expense.bankAccountId?.accountName || "-",
  }));

  const loanRows = loans.map((loan) => ({
    date: loan.date,
    type: "loan",
    partyName: loan.type === "loan_in" ? "Owner Contribution" : "Loan Repayment",
    paymentType: String(loan.paymentType || "cash").toLowerCase(),
    amount: Number(loan.amount || 0),
    remainingAmount: Number(loan.remainingAmount || 0),
    billId: loan._id,
    loanType: loan.type,
    bankAccountId: loan.bankAccountId?._id || loan.bankAccountId || null,
    note: loan.note || "",
    bankAccountName: loan.bankAccountId?.accountName || "-",
  }));

  const returnRows = returns.map((ret) => {
    const linkedInvoice =
      ret.billType === "SALE"
        ? rawSales.find((inv) => String(inv._id) === String(ret.billId))
        : rawPurchases.find((inv) => String(inv._id) === String(ret.billId));
    const invoicePaymentType = String(linkedInvoice?.paymentType || "credit").toLowerCase();
    const invoiceDayBookType =
      invoicePaymentType === "cash" || invoicePaymentType === "bank" ? invoicePaymentType : null;

    return {
      date: ret.returnDate,
      type: ret.returnType === "PURCHASE_RETURN" ? "purchase_return" : "sale_return",
      partyName: ret.partyId?.name || "Cash",
      paymentType: invoiceDayBookType,
      amount: Number(ret.totalAmount || 0),
      billId: ret._id,
      referenceId: ret.billId,
      invoiceNo: ret.returnNo || "-",
    };
  });

  const filteredReturnRows = returnRows.filter(
    (row) =>
      row.paymentType &&
      (paymentTypeFilter === "all" || row.paymentType === paymentTypeFilter),
  );

  const rows = [...salesRows, ...purchaseRows, ...filteredReturnRows, ...paymentRows, ...expenseRows, ...loanRows].sort(
    (a, b) => new Date(a.date) - new Date(b.date),
  );

  const summary = {
    totalSales: sumAmount(salesRows) - sumAmount(filteredReturnRows.filter((row) => row.type === "sale_return")),
    totalPurchase: sumAmount(purchaseRows) - sumAmount(filteredReturnRows.filter((row) => row.type === "purchase_return")),
    totalPaymentReceived: sumAmount(
      paymentRows.filter((row) => row.paymentDirection === "received"),
    ),
    totalPaymentPaid: sumAmount(
      paymentRows.filter((row) => row.paymentDirection === "paid"),
    ),
    totalExpenses: sumAmount(expenseRows),
    totalLoanIn: sumAmount(loanRows.filter((row) => row.loanType === "loan_in")),
    totalLoanOut: sumAmount(loanRows.filter((row) => row.loanType === "loan_out")),
  };
  summary.netMovement =
    summary.totalSales -
    summary.totalPurchase +
    summary.totalPaymentReceived -
    summary.totalPaymentPaid -
    summary.totalExpenses +
    summary.totalLoanIn -
    summary.totalLoanOut;

  return {
    rows: includeRows ? rows : [],
    summary,
  };
};

const computeOpeningBalance = async ({ companyId, selectedDate, paymentTypeFilter }) => {
  const dayStart = startOfDay(selectedDate);
  const manualOpening = await CompanyBalance.findOne({
    companyId,
    date: dayStart,
  });

  if (manualOpening) {
    return {
      openingBalance: Number(manualOpening.openingBalance || 0),
      isManualOpeningBalance: true,
    };
  }

  const latestManualBefore = await CompanyBalance.findOne({
    companyId,
    date: { $lt: dayStart },
  }).sort({ date: -1 });

  const baseDate = latestManualBefore ? startOfDay(latestManualBefore.date) : null;
  const baseBalance = Number(latestManualBefore?.openingBalance || 0);

  if (!baseDate) {
    const movement = await fetchDayBookTransactions({
      companyId,
      fromDate: new Date(0),
      toDate: new Date(dayStart.getTime() - 1),
      paymentTypeFilter,
      includeRows: false,
    });
    return {
      openingBalance: movement.summary.netMovement,
      isManualOpeningBalance: false,
    };
  }

  const movement = await fetchDayBookTransactions({
    companyId,
    fromDate: baseDate,
    toDate: new Date(dayStart.getTime() - 1),
    paymentTypeFilter,
    includeRows: false,
  });

  return {
    openingBalance: baseBalance + movement.summary.netMovement,
    isManualOpeningBalance: false,
  };
};

/* ================= STOCK REPORT ================= */
exports.stockReport = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    const report = await StockLedger.aggregate([
      { $match: { companyId } },

      {
        $group: {
          _id: "$productId",
          inQty: {
            $sum: {
              $cond: [
                {
                  $in: [
                    "$type",
                    ["PURCHASE", "OPENING", "ADJUSTMENT", "SALE_RETURN"],
                  ],
                },
                "$quantity",
                0,
              ],
            },
          },
          outQty: {
            $sum: {
              $cond: [
                { $in: ["$type", ["SALE", "PURCHASE_RETURN"]] },
                "$quantity",
                0,
              ],
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

      {
        $project: {
          productName: "$product.name",
          purchasedQty: "$inQty",
          soldQty: "$outQty",
          currentStock: { $subtract: ["$inQty", "$outQty"] },
        },
      },
    ]);

    res.json(report);
  } catch (err) {
    console.error("Stock Report Error:", err);
    res.status(500).json({ error: "Failed to load stock report" });
  }
};

/* ================= SUPPLIER DUE REPORT ================= */
exports.supplierDueReport = async (req, res) => {
  try {
    const suppliers = await Party.find({
      companyId: req.user.companyId,
      roles: "supplier",
    }).select("name balance");

    res.json(suppliers);
  } catch (err) {
    console.error("Supplier Due Error:", err);
    res.status(500).json({ error: "Failed to load supplier dues" });
  }
};

/* ================= VENDOR DUE REPORT ================= */
exports.vendorDueReport = async (req, res) => {
  try {
    const vendors = await Party.find({
      companyId: req.user.companyId,
      roles: "vendor",
    }).select("name balance");

    res.json(vendors);
  } catch (err) {
    console.error("Vendor Due Error:", err);
    res.status(500).json({ error: "Failed to load vendor dues" });
  }
};

/* ================= PURCHASE REPORT ================= */
exports.purchaseReport = async (req, res) => {
  try {
    const query = { companyId: req.user.companyId };
    const range = getDateRangeFromQuery(req.query);
    if (range) {
      query.invoiceDate = { $gte: range.fromDate, $lte: range.toDate };
    }

    const data = await PurchaseInvoice.find(query)
      .populate("partyId", "name")
      .sort({ invoiceDate: -1 });

    res.json(data);
  } catch (err) {
    console.error("Purchase Report Error:", err);
    res.status(500).json({ error: "Failed to load purchase report" });
  }
};

/* ================= SALES REPORT ================= */
exports.salesReport = async (req, res) => {
  try {
    const query = { companyId: req.user.companyId };
    const range = getDateRangeFromQuery(req.query);
    if (range) {
      query.invoiceDate = { $gte: range.fromDate, $lte: range.toDate };
    }

    const data = await SalesInvoice.find(query)
      .populate("partyId", "name")
      .sort({ invoiceDate: -1 });

    res.json(data);
  } catch (err) {
    console.error("Sales Report Error:", err);
    res.status(500).json({ error: "Failed to load sales report" });
  }
};

/* ================= PROFIT & LOSS ================= */
exports.profitLossReport = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const range = getDateRangeFromQuery(req.query);

    const defaultFrom = new Date();
    defaultFrom.setHours(0, 0, 0, 0);
    const defaultTo = new Date();
    const fromDate = range?.fromDate || defaultFrom;
    const toDate = range?.toDate || defaultTo;
    const summary = await getProfitSummary(companyId, fromDate, toDate);

    res.json({
      totalSales: summary.sales,
      totalPurchase: summary.cost,
      profit: summary.profit,
      cost: summary.cost,
      daily: summary.daily || [],
    });
  } catch (err) {
    console.error("Profit Loss Error:", err);
    res.status(500).json({ error: "Failed to load profit & loss" });
  }
};

/* ================= DAILY REPORT / DAY BOOK ================= */
exports.dailyReport = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const requestedDate = req.query.date || new Date().toISOString().slice(0, 10);
    const selectedDate = new Date(requestedDate);

    if (Number.isNaN(selectedDate.getTime())) {
      return res.status(400).json({ error: "Invalid date" });
    }

    const paymentTypeFilter = String(req.query.paymentType || "all").toLowerCase();
    const billTypeFilter = String(req.query.type || "all").toLowerCase();
    const search = String(req.query.search || "").trim().toLowerCase();
    const validPaymentTypes = ["all", "cash", "bank"];
    const validBillTypes = ["all", "sale", "purchase", "sale_return", "purchase_return", "payment", "expense", "loan"];

    if (!validPaymentTypes.includes(paymentTypeFilter)) {
      return res.status(400).json({ error: "Invalid paymentType" });
    }

    if (!validBillTypes.includes(billTypeFilter)) {
      return res.status(400).json({ error: "Invalid type" });
    }

    const dayStart = startOfDay(selectedDate);
    const dayEnd = endOfDay(selectedDate);

    const matchesSearch = (partyName) => {
      if (!search) return true;
      return String(partyName || "cash").toLowerCase().includes(search);
    };

    const [openingInfo, todayBook] = await Promise.all([
      computeOpeningBalance({
        companyId,
        selectedDate,
        paymentTypeFilter,
      }),
      fetchDayBookTransactions({
        companyId,
        fromDate: dayStart,
        toDate: dayEnd,
        paymentTypeFilter,
      }),
    ]);

    const rows = todayBook.rows
      .filter((row) => matchesSearch(row.partyName))
      .filter((row) => billTypeFilter === "all" || row.type === billTypeFilter)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    const totalSales =
      rows
        .filter((row) => row.type === "sale")
        .reduce((sum, row) => sum + Number(row.amount || 0), 0) -
      rows
        .filter((row) => row.type === "sale_return")
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const totalPurchase =
      rows
        .filter((row) => row.type === "purchase")
        .reduce((sum, row) => sum + Number(row.amount || 0), 0) -
      rows
        .filter((row) => row.type === "purchase_return")
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const totalPaymentReceived = rows
      .filter((row) => row.type === "payment" && row.paymentDirection === "received")
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const totalPaymentPaid = rows
      .filter((row) => row.type === "payment" && row.paymentDirection === "paid")
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const totalExpenses = rows
      .filter((row) => row.type === "expense")
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const totalLoanIn = rows
      .filter((row) => row.type === "loan" && row.loanType === "loan_in")
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const totalLoanOut = rows
      .filter((row) => row.type === "loan" && row.loanType === "loan_out")
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const openingBalance = Number(openingInfo.openingBalance || 0);
    const closingBalance =
      openingBalance +
      totalSales -
      totalPurchase +
      totalPaymentReceived -
      totalPaymentPaid -
      totalExpenses +
      totalLoanIn -
      totalLoanOut;

    res.json({
      rows,
      summary: {
        openingBalance,
        totalSales,
        totalPurchase,
        totalPaymentReceived,
        totalPaymentPaid,
        totalExpenses,
        totalLoanIn,
        totalLoanOut,
        closingBalance,
        isManualOpeningBalance: openingInfo.isManualOpeningBalance,
      },
    });
  } catch (err) {
    console.error("Daily Report Error:", err);
    res.status(500).json({ error: "Failed to load daily report" });
  }
};

exports.dayBookBalanceHistory = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const fromRaw = req.query.from || req.query.date;
    const toRaw = req.query.to || req.query.date || fromRaw;
    const paymentTypeFilter = String(req.query.paymentType || "all").toLowerCase();

    if (!fromRaw || !toRaw) {
      return res.status(400).json({ error: "from and to are required" });
    }

    const fromDate = startOfDay(fromRaw);
    const toDate = startOfDay(toRaw);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) {
      return res.status(400).json({ error: "Invalid date range" });
    }

    const dayCount = Math.floor((toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    if (dayCount > 366) {
      return res.status(400).json({ error: "Date range should not exceed 366 days" });
    }

    const [openingInfo, book, manualOpenings] = await Promise.all([
      computeOpeningBalance({ companyId, selectedDate: fromDate, paymentTypeFilter }),
      fetchDayBookTransactions({
        companyId,
        fromDate,
        toDate: endOfDay(toDate),
        paymentTypeFilter,
      }),
      CompanyBalance.find({
        companyId,
        date: { $gte: fromDate, $lte: toDate },
      }).select("date openingBalance"),
    ]);

    const manualMap = new Map(
      manualOpenings.map((entry) => [toDayKey(entry.date), Number(entry.openingBalance || 0)]),
    );

    const movementMap = new Map();
    book.rows.forEach((row) => {
      const key = toDayKey(row.date);
      const current = movementMap.get(key) || {
        sales: 0,
        purchase: 0,
        paymentReceived: 0,
        paymentPaid: 0,
        expenses: 0,
        loanIn: 0,
        loanOut: 0,
      };

      if (row.type === "sale") current.sales += Number(row.amount || 0);
      if (row.type === "sale_return") current.sales -= Number(row.amount || 0);
      if (row.type === "purchase") current.purchase += Number(row.amount || 0);
      if (row.type === "purchase_return") current.purchase -= Number(row.amount || 0);
      if (row.type === "expense") current.expenses += Number(row.amount || 0);
      if (row.type === "payment" && row.paymentDirection === "received") current.paymentReceived += Number(row.amount || 0);
      if (row.type === "payment" && row.paymentDirection === "paid") current.paymentPaid += Number(row.amount || 0);
      if (row.type === "loan" && row.loanType === "loan_in") current.loanIn += Number(row.amount || 0);
      if (row.type === "loan" && row.loanType === "loan_out") current.loanOut += Number(row.amount || 0);
      movementMap.set(key, current);
    });

    const history = [];
    let runningOpening = Number(openingInfo.openingBalance || 0);

    for (let cursor = startOfDay(fromDate); cursor <= toDate; cursor = addDays(cursor, 1)) {
      const key = toDayKey(cursor);
      if (manualMap.has(key)) {
        runningOpening = manualMap.get(key);
      }
      const movement = movementMap.get(key) || {
        sales: 0,
        purchase: 0,
        paymentReceived: 0,
        paymentPaid: 0,
        expenses: 0,
        loanIn: 0,
        loanOut: 0,
      };
      const closingBalance =
        runningOpening +
        movement.sales -
        movement.purchase +
        movement.paymentReceived -
        movement.paymentPaid -
        movement.expenses +
        movement.loanIn -
        movement.loanOut;

      history.push({
        date: key,
        openingBalance: runningOpening,
        closingBalance,
      });

      runningOpening = closingBalance;
    }

    res.json({ history });
  } catch (err) {
    console.error("Day Book Balance History Error:", err);
    res.status(500).json({ error: "Failed to load balance history" });
  }
};

/* ================= FIFO DEBUG ================= */
exports.fifoDebug = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const productId = req.query.productId;
    const qty = Number(req.query.qty || 0);

    if (!productId) {
      return res.status(400).json({ error: "productId is required" });
    }

    const batches = await StockBatch.find({ companyId, productId })
      .sort({ createdAt: 1, _id: 1 })
      .select("_id sourceType sourceId totalQty remainingQty rate createdAt");

    const preview = qty > 0
      ? await previewConsumeBatches({ companyId, productId, quantity: qty })
      : null;

    res.json({
      productId,
      batches,
      preview,
    });
  } catch (err) {
    console.error("FIFO Debug Error:", err);
    res.status(500).json({ error: "Failed to build FIFO debug report" });
  }
};

/* ================= PARTY LEDGER ================= */
exports.partyLedger = async (req, res) => {
  try {
    const { partyId } = req.params;
    const companyId = req.user.companyId;

    const purchaseInvoices = await PurchaseInvoice.find({
      partyId,
      companyId,
    }).sort({ invoiceDate: -1 });

    const salesInvoices = await SalesInvoice.find({
      partyId,
      companyId,
    }).sort({ invoiceDate: -1 });

    const payments = await Payment.find({
      partyId,
      companyId,
    }).sort({ createdAt: -1 });

    res.json({
      purchaseInvoices,
      salesInvoices,
      payments,
    });
  } catch (err) {
    console.error("Party Ledger Error:", err);
    res.status(500).json({ error: "Failed to load party ledger" });
  }
};
