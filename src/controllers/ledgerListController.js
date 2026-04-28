const Party = require("../models/Party");
const PurchaseInvoice = require("../models/PurchaseInvoice");
const SalesInvoice = require("../models/SalesInvoice");
const Payment = require("../models/Payment");
const ReturnEntry = require("../models/Return");
const Expense = require("../models/Expense");
const BankAccount = require("../models/BankAccount");
const { getDateRangeFromQuery } = require("../utils/dateRange");
const { getPartyBalanceSummaries } = require("../utils/partyBalanceSummary");
const { withBranchScope } = require("../utils/branchScope");

const normalizePaymentType = (v) => {
  const t = String(v || "credit").toLowerCase();
  return ["cash", "bank", "credit"].includes(t) ? t : "credit";
};

const paymentModeToChannel = (mode) => {
  const m = String(mode || "").toUpperCase();
  if (m === "CASH") return "cash";
  // Treat UPI/CHEQUE/BANK as bank-channel for this UI.
  if (m === "BANK" || m === "UPI" || m === "CHEQUE") return "bank";
  return "bank";
};

const buildDateQueries = (req) => {
  const range = getDateRangeFromQuery(req.query);
  if (!range) return { invoiceDateQuery: {}, paymentDateQuery: {}, returnDateQuery: {} };
  const q = { $gte: range.fromDate, $lte: range.toDate };
  return {
    invoiceDateQuery: { invoiceDate: q },
    paymentDateQuery: { paymentDate: q },
    returnDateQuery: { returnDate: q },
  };
};

// Returns grouped rows for Ledger List page.
exports.getLedgerList = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const filterType = String(req.query.type || "all").toLowerCase();
    const bankAccountId = req.query.bankAccountId || "";
    const { invoiceDateQuery, paymentDateQuery, returnDateQuery } = buildDateQueries(req);
    const range = getDateRangeFromQuery(req.query);

    const [partySummaries, parties, purchases, sales, payments, returns, bankAccounts] = await Promise.all([
      getPartyBalanceSummaries({
        companyId,
        range,
        branchId: req.user.branchId,
        branchIsDefault: req.user.branchIsDefault,
      }),
      Party.find({
        ...withBranchScope({ companyId }, req.user.branchId, req.user.branchIsDefault),
        isActive: true,
      }).select("name roles"),
      PurchaseInvoice.find({ ...withBranchScope({ companyId }, req.user.branchId, req.user.branchIsDefault), ...invoiceDateQuery }).select(
        "partyId totalAmount paidAmount paymentType invoiceNo bankAccountId _id",
      ),
      SalesInvoice.find({ ...withBranchScope({ companyId }, req.user.branchId, req.user.branchIsDefault), ...invoiceDateQuery }).select(
        "partyId totalAmount paidAmount paymentType invoiceNo bankAccountId _id",
      ),
      Payment.find({ ...withBranchScope({ companyId }, req.user.branchId, req.user.branchIsDefault), ...paymentDateQuery }).select(
        "partyId amount paymentType invoiceType invoiceId paymentMode bankAccountId _id",
      ),
      ReturnEntry.find({ ...withBranchScope({ companyId }, req.user.branchId, req.user.branchIsDefault), ...returnDateQuery }).select(
        "partyId returnType totalAmount billType billId returnNo _id",
      ),
      BankAccount.find({ companyId }).select("accountName"),
    ]);

    const partyById = new Map(parties.map((p) => [String(p._id), p]));
    const bankAccountNameMap = new Map(
      bankAccounts.map((account) => [String(account._id), account.accountName || "Bank"]),
    );

    const purchasePayTypeMap = new Map(purchases.map((p) => [String(p._id), normalizePaymentType(p.paymentType)]));
    const salesPayTypeMap = new Map(sales.map((s) => [String(s._id), normalizePaymentType(s.paymentType)]));
    const purchaseBankAccountMap = new Map(
      purchases.map((p) => [String(p._id), p.bankAccountId ? String(p.bankAccountId) : ""]),
    );
    const salesBankAccountMap = new Map(
      sales.map((s) => [String(s._id), s.bankAccountId ? String(s.bankAccountId) : ""]),
    );

    const partyRows = partySummaries.map((summary) => {
      const roles = summary.roles || [];
      const isCustomerView = filterType === "customer";
      const isSupplierView = filterType === "supplier";
      const totalAmount = isCustomerView
        ? summary.openingReceivable + summary.salesNet
        : isSupplierView
        ? summary.openingPayable + summary.purchaseNet
        : summary.totalInvoiceAmount;
      const paid = isCustomerView
        ? summary.paymentReceived
        : isSupplierView
        ? summary.paymentPaid
        : summary.paymentReceived + summary.paymentPaid;
      const outstanding = isCustomerView
        ? summary.customerOutstanding
        : isSupplierView
        ? summary.supplierOutstanding
        : summary.customerOutstanding + summary.supplierOutstanding;
      const totalInvoices = isCustomerView
        ? summary.salesCount
        : isSupplierView
        ? summary.purchaseCount
        : summary.totalInvoices;
      const totalTransactions = isCustomerView
        ? summary.salesCount + summary.saleReturnCount + summary.paymentCount
        : isSupplierView
        ? summary.purchaseCount + summary.purchaseReturnCount + summary.paymentCount
        : summary.totalTransactions;

      return {
        name: summary.partyName,
        totalAmount,
        outstanding,
        remainingAmount: summary.remainingAmount,
        paid,
        totalBills: totalInvoices,
        totalInvoices,
        totalTransactions,
        type: "party",
        referenceId: String(summary.partyId),
        roles,
      };
    });

    const createChannelRow = ({ type, accountId = "", name }) => ({
      type,
      referenceId: accountId || type,
      name,
      bankAccountId: accountId || null,
      totalAmount: 0,
      paid: 0,
      outstanding: 0,
      remainingAmount: 0,
      totalBills: 0,
      totalInvoices: 0,
      totalTransactions: 0,
      _sales: 0,
      _purchase: 0,
      _salesAmount: 0,
      _purchaseAmount: 0,
      _saleReturns: 0,
      _purchaseReturns: 0,
      _saleReturnAmount: 0,
      _purchaseReturnAmount: 0,
      _paymentsReceived: 0,
      _paymentsPaid: 0,
      _expenses: 0,
      _paymentCount: 0,
    });

    const channelAgg = new Map();
    const ensureChannelRow = (type, accountId = "") => {
      const normalizedType = String(type || "").toLowerCase();
      if (normalizedType !== "cash" && normalizedType !== "bank") return null;
      const key =
        normalizedType === "bank" && (filterType === "bank" || bankAccountId)
          ? `${normalizedType}:${accountId || "all"}`
          : normalizedType;
      if (!channelAgg.has(key)) {
        const name =
          normalizedType === "cash"
            ? "Cash"
            : accountId
            ? bankAccountNameMap.get(String(accountId)) || "Bank"
            : "Bank";
        channelAgg.set(key, createChannelRow({ type: normalizedType, accountId, name }));
      }
      return channelAgg.get(key);
    };

    sales.forEach((invoice) => {
      const paymentType = normalizePaymentType(invoice.paymentType);
      if (paymentType === "credit") return;
      const accountId =
        paymentType === "bank" && invoice.bankAccountId ? String(invoice.bankAccountId) : "";
      const row = ensureChannelRow(paymentType, accountId);
      if (!row) return;
      row._salesAmount += Number(invoice.totalAmount || 0);
      row._sales += 1;
    });

    purchases.forEach((invoice) => {
      const paymentType = normalizePaymentType(invoice.paymentType);
      if (paymentType === "credit") return;
      const accountId =
        paymentType === "bank" && invoice.bankAccountId ? String(invoice.bankAccountId) : "";
      const row = ensureChannelRow(paymentType, accountId);
      if (!row) return;
      row._purchaseAmount += Number(invoice.totalAmount || 0);
      row._purchase += 1;
    });

    returns.forEach((entry) => {
      const paymentType =
        entry.billType === "PURCHASE"
          ? purchasePayTypeMap.get(String(entry.billId)) || "credit"
          : salesPayTypeMap.get(String(entry.billId)) || "credit";
      if (paymentType === "credit") return;
      const accountId =
        paymentType === "bank"
          ? entry.billType === "PURCHASE"
            ? purchaseBankAccountMap.get(String(entry.billId)) || ""
            : salesBankAccountMap.get(String(entry.billId)) || ""
          : "";
      const row = ensureChannelRow(paymentType, accountId);
      if (!row) return;
      if (entry.returnType === "SALE_RETURN") {
        row._saleReturns += 1;
        row._saleReturnAmount += Number(entry.totalAmount || 0);
      }
      if (entry.returnType === "PURCHASE_RETURN") {
        row._purchaseReturns += 1;
        row._purchaseReturnAmount += Number(entry.totalAmount || 0);
      }
    });

    payments.forEach((payment) => {
      const channelType = paymentModeToChannel(payment.paymentMode);
      const accountId =
        channelType === "bank" && payment.bankAccountId ? String(payment.bankAccountId) : "";
      const row = ensureChannelRow(channelType, accountId);
      if (!row) return;
      const isReceived =
        String(payment.paymentType || "").toUpperCase() === "RECEIVED" ||
        String(payment.invoiceType || "").toUpperCase() === "SALE";
      row._paymentCount += 1;
      if (isReceived) row._paymentsReceived += Number(payment.amount || 0);
      else row._paymentsPaid += Number(payment.amount || 0);
    });

    const expenses = await Expense.find({
      ...withBranchScope({ companyId }, req.user.branchId, req.user.branchIsDefault),
      ...(returnDateQuery.returnDate ? { date: returnDateQuery.returnDate } : {}),
      paymentType: { $in: ["cash", "bank"] },
    }).select("amount paymentType bankAccountId");

    expenses.forEach((expense) => {
      const paymentType = String(expense.paymentType || "cash").toLowerCase();
      const accountId =
        paymentType === "bank" && expense.bankAccountId ? String(expense.bankAccountId) : "";
      const row = ensureChannelRow(paymentType, accountId);
      if (!row) return;
      row._expenses += Number(expense.amount || 0);
    });

    channelAgg.forEach((row) => {
      row.totalAmount =
        row._salesAmount -
        row._saleReturnAmount +
        row._purchaseAmount -
        row._purchaseReturnAmount;
      row.paid = row._paymentsReceived + row._paymentsPaid;
      row.totalInvoices = row._sales + row._purchase;
      row.totalBills = row.totalInvoices;
      row.totalTransactions =
        row.totalInvoices +
        row._saleReturns +
        row._purchaseReturns +
        row._paymentCount;
      row.remainingAmount =
        row._salesAmount +
        row._purchaseReturnAmount +
        row._paymentsPaid +
        row._expenses -
        row._purchaseAmount -
        row._saleReturnAmount -
        row._paymentsReceived;
      row.outstanding = Math.abs(row.remainingAmount);
    });

    const matchesFilter = (entry) => {
      if (filterType === "all") return true;
      if (filterType === "party") return !!entry.partyId;
      if (filterType === "cash" || filterType === "bank") {
        if (entry.paymentType !== filterType) return false;
        if (filterType === "bank" && bankAccountId) {
          return String(entry.bankAccountId || "") === String(bankAccountId);
        }
        return true;
      }
      if (filterType === "customer" || filterType === "supplier") {
        if (!entry.partyId) return false;
        const party = partyById.get(String(entry.partyId));
        return party ? (party.roles || []).includes(filterType) : false;
      }
      return true;
    };

    const summaryTotals = { totalBillAmount: 0, totalOutstanding: 0, totalPaid: 0 };
    const summaryKeyed = new Map();

    const addSummaryEntry = (key, entry) => {
      if (summaryKeyed.has(key)) return;
      if (!matchesFilter(entry)) return;
      summaryKeyed.set(key, entry);
      summaryTotals.totalBillAmount += Number(entry.totalBillAmount || 0);
      summaryTotals.totalPaid += Number(entry.totalPaid || 0);
    };

    sales.forEach((s) => {
      const entry = {
        partyId: s.partyId,
        paymentType: normalizePaymentType(s.paymentType),
        bankAccountId: s.bankAccountId || null,
        totalBillAmount: Number(s.totalAmount || 0),
        totalPaid: 0,
      };
      addSummaryEntry(`sale:${s._id}`, entry);
    });

    purchases.forEach((p) => {
      const entry = {
        partyId: p.partyId,
        paymentType: normalizePaymentType(p.paymentType),
        bankAccountId: p.bankAccountId || null,
        totalBillAmount: Number(p.totalAmount || 0),
        totalPaid: 0,
      };
      addSummaryEntry(`purchase:${p._id}`, entry);
    });

    returns.forEach((r) => {
      const mappedPaymentType =
        r.billType === "PURCHASE"
          ? purchasePayTypeMap.get(String(r.billId)) || "credit"
          : salesPayTypeMap.get(String(r.billId)) || "credit";
      const entry = {
        partyId: r.partyId,
        paymentType: mappedPaymentType,
        bankAccountId:
          mappedPaymentType === "bank"
            ? r.billType === "PURCHASE"
              ? purchaseBankAccountMap.get(String(r.billId)) || null
              : salesBankAccountMap.get(String(r.billId)) || null
            : null,
        totalBillAmount: -Number(r.totalAmount || 0),
        totalPaid: 0,
      };
      addSummaryEntry(`return:${r._id}`, entry);
    });

    payments.forEach((p) => {
      const entry = {
        partyId: p.partyId,
        paymentType: paymentModeToChannel(p.paymentMode),
        bankAccountId: p.bankAccountId || null,
        totalBillAmount: 0,
        totalPaid: Number(p.amount || 0),
      };
      addSummaryEntry(`payment:${p._id}`, entry);
    });

    summaryTotals.totalOutstanding = summaryTotals.totalBillAmount - summaryTotals.totalPaid;

    // Apply filter rules
    let result = [];
    if (filterType === "cash" || filterType === "bank") {
      result = Array.from(channelAgg.values()).filter((row) => {
        if (row.type !== filterType) return false;
        if (filterType === "bank" && bankAccountId) {
          return String(row.bankAccountId || "") === String(bankAccountId);
        }
        return true;
      });
    } else if (filterType === "customer" || filterType === "supplier") {
      const role = filterType;
      result = partyRows.filter((r) => (r.roles || []).includes(role));
    } else if (filterType === "party") {
      result = partyRows;
    } else {
      result = [...partyRows, ...Array.from(channelAgg.values())];
    }

    res.json({
      rows: result,
      summary: summaryTotals,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Returns ledger transactions across all parties for cash/bank/all.
exports.getLedgerTransactions = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const filterType = String(req.query.type || "all").toLowerCase();
    const bankAccountId = req.query.bankAccountId || "";
    const { invoiceDateQuery, paymentDateQuery, returnDateQuery } = buildDateQueries(req);
    const expenseDateQuery = returnDateQuery.returnDate ? { date: returnDateQuery.returnDate } : {};

    const [purchases, sales, payments, returns, expenses] = await Promise.all([
      PurchaseInvoice.find({
        ...withBranchScope({ companyId }, req.user.branchId, req.user.branchIsDefault),
        ...invoiceDateQuery,
        ...(filterType === "bank" && bankAccountId ? { bankAccountId } : {}),
      }).select(
        "invoiceDate totalAmount invoiceNo paymentType partyId bankAccountId _id",
      ),
      SalesInvoice.find({
        ...withBranchScope({ companyId }, req.user.branchId, req.user.branchIsDefault),
        ...invoiceDateQuery,
        ...(filterType === "bank" && bankAccountId ? { bankAccountId } : {}),
      }).select(
        "invoiceDate totalAmount invoiceNo paymentType partyId bankAccountId _id",
      ),
      Payment.find({
        ...withBranchScope({ companyId }, req.user.branchId, req.user.branchIsDefault),
        ...paymentDateQuery,
        ...(filterType === "bank" && bankAccountId ? { bankAccountId } : {}),
      }).select(
        "paymentDate amount paymentMode paymentType invoiceType invoiceId partyId bankAccountId adjustType _id",
      ),
      ReturnEntry.find({ ...withBranchScope({ companyId }, req.user.branchId, req.user.branchIsDefault), ...returnDateQuery }).select(
        "returnDate returnType totalAmount billType billId returnNo partyId _id",
      ),
      Expense.find({
        ...withBranchScope({ companyId }, req.user.branchId, req.user.branchIsDefault),
        ...expenseDateQuery,
        ...(filterType === "bank" && bankAccountId ? { paymentType: "bank", bankAccountId } : {}),
      }).select("date title amount paymentType note partyId bankAccountId _id"),
    ]);

    const purchaseNoMap = new Map(purchases.map((p) => [String(p._id), p.invoiceNo || "-"]));
    const salesNoMap = new Map(sales.map((s) => [String(s._id), s.invoiceNo || "-"]));
    const purchasePayTypeMap = new Map(purchases.map((p) => [String(p._id), normalizePaymentType(p.paymentType)]));
    const salesPayTypeMap = new Map(sales.map((s) => [String(s._id), normalizePaymentType(s.paymentType)]));
    const purchaseBankAccountMap = new Map(
      purchases.map((p) => [String(p._id), p.bankAccountId ? String(p.bankAccountId) : ""]),
    );
    const salesBankAccountMap = new Map(
      sales.map((s) => [String(s._id), s.bankAccountId ? String(s.bankAccountId) : ""]),
    );

    const partyIds = new Set();
    [...purchases, ...sales, ...payments, ...returns].forEach((d) => {
      const id = d.partyId ? String(d.partyId) : "";
      if (id) partyIds.add(id);
    });
    const partyNameMap = new Map();
    if (partyIds.size) {
      const partyDocs = await Party.find({ companyId, _id: { $in: Array.from(partyIds) } }).select("name");
      partyDocs.forEach((p) => partyNameMap.set(String(p._id), p.name || "-"));
    }
    const partyName = (id) => (id ? partyNameMap.get(String(id)) || "-" : "-");

    const ledger = [];

    purchases.forEach((p) => {
      ledger.push({
        date: p.invoiceDate,
        type: "PURCHASE",
        bill_no: p.invoiceNo || "-",
        debit: 0,
        credit: Number(p.totalAmount || 0),
        balance: 0,
        billId: p._id,
        billType: "PURCHASE",
        partyId: p.partyId,
        partyName: partyName(p.partyId),
        paymentType: normalizePaymentType(p.paymentType),
        bankAccountId: p.bankAccountId || null,
      });
    });

    sales.forEach((s) => {
      ledger.push({
        date: s.invoiceDate,
        type: "SALE",
        bill_no: s.invoiceNo || "-",
        debit: Number(s.totalAmount || 0),
        credit: 0,
        balance: 0,
        billId: s._id,
        billType: "SALE",
        partyId: s.partyId,
        partyName: partyName(s.partyId),
        paymentType: normalizePaymentType(s.paymentType),
        bankAccountId: s.bankAccountId || null,
      });
    });

    payments.forEach((p) => {
      const isReceived = p.paymentType === "RECEIVED" || p.invoiceType === "SALE";
      const invoiceNo =
        p.invoiceType === "OPENING"
          ? "-"
          : p.invoiceType === "PURCHASE"
          ? purchaseNoMap.get(String(p.invoiceId)) || "-"
          : salesNoMap.get(String(p.invoiceId)) || "-";
      ledger.push({
        date: p.paymentDate,
        type: "PAYMENT",
        bill_no: invoiceNo,
        debit: isReceived ? 0 : Number(p.amount || 0),
        credit: isReceived ? Number(p.amount || 0) : 0,
        balance: 0,
        billId: p.invoiceId,
        billType: p.invoiceType,
        partyId: p.partyId,
        partyName: partyName(p.partyId),
        paymentType: paymentModeToChannel(p.paymentMode),
        bankAccountId: p.bankAccountId || null,
      });
    });

    returns.forEach((r) => {
      const isSaleReturn = r.returnType === "SALE_RETURN";
      const returnBillNo = r.returnNo || `RET-${String(r._id).slice(-6).toUpperCase()}`;
      const mappedPaymentType =
        r.billType === "PURCHASE"
          ? purchasePayTypeMap.get(String(r.billId)) || "credit"
          : salesPayTypeMap.get(String(r.billId)) || "credit";
      const mappedBankAccountId =
        mappedPaymentType === "bank"
          ? r.billType === "PURCHASE"
            ? purchaseBankAccountMap.get(String(r.billId)) || null
            : salesBankAccountMap.get(String(r.billId)) || null
          : null;
      ledger.push({
        date: r.returnDate,
        type: r.returnType,
        bill_no: returnBillNo,
        debit: isSaleReturn ? 0 : Number(r.totalAmount || 0),
        credit: isSaleReturn ? Number(r.totalAmount || 0) : 0,
        balance: 0,
        billId: r.billId,
        billType: r.billType,
        partyId: r.partyId,
        partyName: partyName(r.partyId),
        paymentType: mappedPaymentType,
        bankAccountId: mappedBankAccountId,
      });
    });

    expenses.forEach((expense) => {
      ledger.push({
        date: expense.date,
        type: "EXPENSE",
        bill_no: "-",
        debit: Number(expense.amount || 0),
        credit: 0,
        balance: 0,
        billId: expense._id,
        billType: "EXPENSE",
        partyId: expense.partyId || null,
        partyName: expense.title || "-",
        paymentType: String(expense.paymentType || "cash").toLowerCase(),
        bankAccountId: expense.bankAccountId || null,
      });
    });

    // Apply type filter
    let filtered = ledger;
    if (filterType === "cash" || filterType === "bank") {
      filtered = ledger.filter((e) => e.paymentType === filterType);
      if (filterType === "bank" && bankAccountId) {
        filtered = filtered.filter((e) => String(e.bankAccountId || "") === String(bankAccountId));
      }
    } else if (filterType === "party") {
      filtered = ledger.filter((e) => !!e.partyId);
    }

    filtered.sort((a, b) => new Date(a.date) - new Date(b.date));
    let balance = 0;
    const withBalance = filtered.map((e) => {
      balance = balance + Number(e.debit || 0) - Number(e.credit || 0);
      return { ...e, balance };
    });

    res.json({
      type: filterType,
      ledger: withBalance,
      closingBalance: balance,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
