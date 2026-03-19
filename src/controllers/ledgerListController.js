const Party = require("../models/Party");
const PurchaseInvoice = require("../models/PurchaseInvoice");
const SalesInvoice = require("../models/SalesInvoice");
const Payment = require("../models/Payment");
const ReturnEntry = require("../models/Return");
const { getDateRangeFromQuery } = require("../utils/dateRange");

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

const filterLedgerEntriesByType = (entries, type) => {
  const t = String(type || "all").toLowerCase();
  if (t === "all") return entries;
  if (t === "party") return entries.filter((e) => !!e.partyId);
  if (t === "cash" || t === "bank" || t === "credit") {
    return entries.filter((e) => e.paymentType === t);
  }
  if (t === "customer") {
    return entries.filter((e) => e.partyRole === "customer");
  }
  if (t === "supplier") {
    return entries.filter((e) => e.partyRole === "supplier");
  }
  return entries;
};

// Returns grouped rows for Ledger List page.
exports.getLedgerList = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const filterType = String(req.query.type || "all").toLowerCase();
    const { invoiceDateQuery, paymentDateQuery, returnDateQuery } = buildDateQueries(req);

    const parties = await Party.find({ companyId, isActive: true }).select("name roles");
    const partyById = new Map(parties.map((p) => [String(p._id), p]));

    const [purchases, sales, payments, returns] = await Promise.all([
      PurchaseInvoice.find({ companyId, ...invoiceDateQuery }).select(
        "partyId totalAmount paidAmount paymentType invoiceNo _id",
      ),
      SalesInvoice.find({ companyId, ...invoiceDateQuery }).select(
        "partyId totalAmount paidAmount paymentType invoiceNo _id",
      ),
      Payment.find({ companyId, ...paymentDateQuery }).select(
        "partyId amount paymentType invoiceType invoiceId paymentMode _id",
      ),
      ReturnEntry.find({ companyId, ...returnDateQuery }).select(
        "partyId returnType totalAmount billType billId returnNo _id",
      ),
    ]);

    // Map billId -> invoice paymentType (used for return classification)
    const purchasePayTypeMap = new Map(purchases.map((p) => [String(p._id), normalizePaymentType(p.paymentType)]));
    const salesPayTypeMap = new Map(sales.map((s) => [String(s._id), normalizePaymentType(s.paymentType)]));

    // Aggregate by partyId
    const partyAgg = new Map();
    const ensureParty = (partyId) => {
      const id = String(partyId || "");
      if (!id) return null;
      if (!partyAgg.has(id)) {
        const p = partyById.get(id);
        partyAgg.set(id, {
          type: "party",
          referenceId: id,
          name: p?.name || "-",
          roles: p?.roles || [],
          totalSales: 0,
          totalPurchase: 0,
          saleReturns: 0,
          purchaseReturns: 0,
          paidReceived: 0,
          paidPaid: 0,
          invoiceCount: 0,
          returnCount: 0,
          paymentCount: 0,
        });
      }
      return partyAgg.get(id);
    };

    sales.forEach((s) => {
      const row = ensureParty(s.partyId);
      if (!row) return;
      row.totalSales += Number(s.totalAmount || 0);
      row.invoiceCount += 1;
    });
    purchases.forEach((p) => {
      const row = ensureParty(p.partyId);
      if (!row) return;
      row.totalPurchase += Number(p.totalAmount || 0);
      row.invoiceCount += 1;
    });
    returns.forEach((r) => {
      const row = ensureParty(r.partyId);
      if (!row) return;
      if (r.returnType === "SALE_RETURN") row.saleReturns += Number(r.totalAmount || 0);
      if (r.returnType === "PURCHASE_RETURN") row.purchaseReturns += Number(r.totalAmount || 0);
      row.returnCount += 1;
    });
    payments.forEach((p) => {
      const row = ensureParty(p.partyId);
      if (!row) return;
      row.paymentCount += 1;
      const isReceived = p.paymentType === "RECEIVED" || p.invoiceType === "SALE";
      if (isReceived) row.paidReceived += Number(p.amount || 0);
      else row.paidPaid += Number(p.amount || 0);
    });

    const partyRows = Array.from(partyAgg.values()).map((r) => {
      const totalSalesNet = r.totalSales - r.saleReturns;
      const totalPurchaseNet = r.totalPurchase - r.purchaseReturns;
      const totalAmount = totalSalesNet + totalPurchaseNet;
      const paid = r.paidReceived + r.paidPaid;
      const outstanding = totalAmount - paid;
      const totalInvoices = r.invoiceCount; // Sale + Purchase only
      const totalTransactions = r.invoiceCount + r.returnCount + r.paymentCount; // invoices + returns + payments
      return {
        name: r.name,
        totalAmount,
        outstanding,
        paid,
        totalBills: totalInvoices, // backward compatible
        totalInvoices,
        totalTransactions,
        type: "party",
        referenceId: r.referenceId,
        roles: r.roles,
      };
    });

    // Aggregate by paymentType across invoices/returns only (this is what makes walk-in cash/bank visible)
    const channelAgg = new Map(
      ["cash", "bank", "credit"].map((t) => [
        t,
        {
          type: t,
          referenceId: t,
          name: t === "cash" ? "Cash" : t === "bank" ? "Bank" : "Credit",
          totalAmount: 0,
          paid: 0,
          outstanding: 0,
          totalBills: 0, // backward compatible
          totalInvoices: 0,
          totalTransactions: 0,
          _sales: 0,
          _purchase: 0,
          _returns: 0,
          _payments: 0,
        },
      ]),
    );

    sales.forEach((s) => {
      const t = normalizePaymentType(s.paymentType);
      const row = channelAgg.get(t);
      row.totalAmount += Number(s.totalAmount || 0);
      row.paid += Number(s.paidAmount || 0);
      row._sales += 1;
    });
    purchases.forEach((p) => {
      const t = normalizePaymentType(p.paymentType);
      const row = channelAgg.get(t);
      row.totalAmount += Number(p.totalAmount || 0);
      row.paid += Number(p.paidAmount || 0);
      row._purchase += 1;
    });
    returns.forEach((r) => {
      const t =
        r.billType === "PURCHASE"
          ? purchasePayTypeMap.get(String(r.billId)) || "credit"
          : salesPayTypeMap.get(String(r.billId)) || "credit";
      const row = channelAgg.get(t);
      row.totalAmount -= Number(r.totalAmount || 0);
      row._returns += 1;
    });

    // Count payments by channel (this matches what ledger/type/cash & /bank show)
    payments.forEach((p) => {
      const ch = paymentModeToChannel(p.paymentMode);
      const row = channelAgg.get(ch);
      if (!row) return;
      row._payments += 1;
    });

    channelAgg.forEach((row) => {
      row.outstanding = Number(row.totalAmount || 0) - Number(row.paid || 0);
      row.totalInvoices = Number(row._sales || 0) + Number(row._purchase || 0);
      row.totalBills = row.totalInvoices;
      row.totalTransactions =
        row.totalInvoices + Number(row._returns || 0) + Number(row._payments || 0);
    });

    // Apply filter rules
    let result = [];
    if (filterType === "cash" || filterType === "bank" || filterType === "credit") {
      result = [channelAgg.get(filterType)];
    } else if (filterType === "customer" || filterType === "supplier") {
      const role = filterType;
      result = partyRows.filter((r) => (r.roles || []).includes(role));
    } else if (filterType === "party") {
      result = partyRows;
    } else {
      // all: include party rows + channels
      result = [...partyRows, ...Array.from(channelAgg.values())];
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Returns ledger transactions across all parties for cash/bank/credit/all.
exports.getLedgerTransactions = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const filterType = String(req.query.type || "all").toLowerCase();
    const { invoiceDateQuery, paymentDateQuery, returnDateQuery } = buildDateQueries(req);

    const [purchases, sales, payments, returns] = await Promise.all([
      PurchaseInvoice.find({ companyId, ...invoiceDateQuery }).select(
        "invoiceDate totalAmount invoiceNo paymentType partyId _id",
      ),
      SalesInvoice.find({ companyId, ...invoiceDateQuery }).select(
        "invoiceDate totalAmount invoiceNo paymentType partyId _id",
      ),
      Payment.find({ companyId, ...paymentDateQuery }).select(
        "paymentDate amount paymentMode paymentType invoiceType invoiceId partyId _id",
      ),
      ReturnEntry.find({ companyId, ...returnDateQuery }).select(
        "returnDate returnType totalAmount billType billId returnNo partyId _id",
      ),
    ]);

    const purchaseNoMap = new Map(purchases.map((p) => [String(p._id), p.invoiceNo || "-"]));
    const salesNoMap = new Map(sales.map((s) => [String(s._id), s.invoiceNo || "-"]));
    const purchasePayTypeMap = new Map(purchases.map((p) => [String(p._id), normalizePaymentType(p.paymentType)]));
    const salesPayTypeMap = new Map(sales.map((s) => [String(s._id), normalizePaymentType(s.paymentType)]));

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
      });
    });

    payments.forEach((p) => {
      const isReceived = p.paymentType === "RECEIVED" || p.invoiceType === "SALE";
      const invoiceNo =
        p.invoiceType === "PURCHASE"
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
      });
    });

    returns.forEach((r) => {
      const isSaleReturn = r.returnType === "SALE_RETURN";
      const returnBillNo = r.returnNo || `RET-${String(r._id).slice(-6).toUpperCase()}`;
      const mappedPaymentType =
        r.billType === "PURCHASE"
          ? purchasePayTypeMap.get(String(r.billId)) || "credit"
          : salesPayTypeMap.get(String(r.billId)) || "credit";
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
      });
    });

    // Apply type filter
    let filtered = ledger;
    if (filterType === "cash" || filterType === "bank" || filterType === "credit") {
      filtered = ledger.filter((e) => e.paymentType === filterType);
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
