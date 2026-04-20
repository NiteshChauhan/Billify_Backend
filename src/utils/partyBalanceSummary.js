const Party = require("../models/Party");
const PurchaseInvoice = require("../models/PurchaseInvoice");
const SalesInvoice = require("../models/SalesInvoice");
const Payment = require("../models/Payment");
const ReturnEntry = require("../models/Return");

const buildDateQueries = (range) => {
  if (!range) {
    return {
      invoiceDateQuery: {},
      paymentDateQuery: {},
      returnDateQuery: {},
    };
  }

  const query = { $gte: range.fromDate, $lte: range.toDate };
  return {
    invoiceDateQuery: { invoiceDate: query },
    paymentDateQuery: { paymentDate: query },
    returnDateQuery: { returnDate: query },
  };
};

const createEmptySummary = (party) => {
  const openingBalance = Number(party?.openingBalance || 0);
  const openingType = String(party?.openingType || "receivable").toLowerCase();
  const openingReceivable = openingType === "receivable" ? openingBalance : 0;
  const openingPayable = openingType === "payable" ? openingBalance : 0;

  return {
    partyId: party?._id || null,
    partyName: party?.name || "-",
    roles: party?.roles || [],
    openingReceivable,
    openingPayable,
    salesAmount: 0,
    purchaseAmount: 0,
    saleReturnAmount: 0,
    purchaseReturnAmount: 0,
    paymentReceived: 0,
    paymentPaid: 0,
    salesCount: 0,
    purchaseCount: 0,
    saleReturnCount: 0,
    purchaseReturnCount: 0,
    paymentCount: 0,
  };
};

const finalizeSummary = (summary) => {
  const salesNet = summary.salesAmount - summary.saleReturnAmount;
  const purchaseNet = summary.purchaseAmount - summary.purchaseReturnAmount;
  const customerRaw = summary.openingReceivable + salesNet - summary.paymentReceived;
  const supplierRaw = summary.openingPayable + purchaseNet - summary.paymentPaid;
  const remainingAmount = customerRaw - supplierRaw;

  return {
    ...summary,
    salesNet,
    purchaseNet,
    totalInvoiceAmount:
      summary.openingReceivable + summary.openingPayable + salesNet + purchaseNet,
    customerOutstanding: Math.max(0, customerRaw),
    supplierOutstanding: Math.max(0, supplierRaw),
    remainingAmount,
    totalInvoices: summary.salesCount + summary.purchaseCount,
    totalTransactions:
      summary.salesCount +
      summary.purchaseCount +
      summary.saleReturnCount +
      summary.purchaseReturnCount +
      summary.paymentCount,
  };
};

const getPartyBalanceSummaries = async ({ companyId, range }) => {
  const { invoiceDateQuery, paymentDateQuery, returnDateQuery } = buildDateQueries(range);

  const [parties, sales, purchases, payments, returns] = await Promise.all([
    Party.find({ companyId, isActive: true }).select(
      "name roles openingBalance openingType",
    ),
    SalesInvoice.find({ companyId, ...invoiceDateQuery }).select(
      "partyId totalAmount _id",
    ),
    PurchaseInvoice.find({ companyId, ...invoiceDateQuery }).select(
      "partyId totalAmount _id",
    ),
    Payment.find({ companyId, ...paymentDateQuery }).select(
      "partyId amount paymentType invoiceType _id",
    ),
    ReturnEntry.find({ companyId, ...returnDateQuery }).select(
      "partyId totalAmount returnType _id",
    ),
  ]);

  const summaryMap = new Map();
  parties.forEach((party) => {
    summaryMap.set(String(party._id), createEmptySummary(party));
  });

  const ensureSummary = (partyId) => {
    if (!partyId) return null;
    const key = String(partyId);
    if (!summaryMap.has(key)) {
      summaryMap.set(key, createEmptySummary({ _id: partyId, name: "-", roles: [] }));
    }
    return summaryMap.get(key);
  };

  sales.forEach((invoice) => {
    const summary = ensureSummary(invoice.partyId);
    if (!summary) return;
    summary.salesAmount += Number(invoice.totalAmount || 0);
    summary.salesCount += 1;
  });

  purchases.forEach((invoice) => {
    const summary = ensureSummary(invoice.partyId);
    if (!summary) return;
    summary.purchaseAmount += Number(invoice.totalAmount || 0);
    summary.purchaseCount += 1;
  });

  payments.forEach((payment) => {
    const summary = ensureSummary(payment.partyId);
    if (!summary) return;
    summary.paymentCount += 1;
    const isReceived =
      String(payment.paymentType || "").toUpperCase() === "RECEIVED" ||
      String(payment.invoiceType || "").toUpperCase() === "SALE";
    if (isReceived) {
      summary.paymentReceived += Number(payment.amount || 0);
    } else {
      summary.paymentPaid += Number(payment.amount || 0);
    }
  });

  returns.forEach((entry) => {
    const summary = ensureSummary(entry.partyId);
    if (!summary) return;
    if (entry.returnType === "SALE_RETURN") {
      summary.saleReturnAmount += Number(entry.totalAmount || 0);
      summary.saleReturnCount += 1;
      return;
    }
    if (entry.returnType === "PURCHASE_RETURN") {
      summary.purchaseReturnAmount += Number(entry.totalAmount || 0);
      summary.purchaseReturnCount += 1;
    }
  });

  return Array.from(summaryMap.values()).map(finalizeSummary);
};

const getRoleOutstandingRows = async ({ companyId, role, range }) => {
  const normalizedRole = String(role || "").toLowerCase();
  const summaries = await getPartyBalanceSummaries({ companyId, range });

  return summaries
    .filter((summary) => (summary.roles || []).includes(normalizedRole))
    .map((summary) => {
      const isSupplier = normalizedRole === "supplier";
      return {
        partyId: summary.partyId,
        partyName: summary.partyName,
        role: normalizedRole,
        total: isSupplier
          ? summary.openingPayable + summary.purchaseNet
          : summary.openingReceivable + summary.salesNet,
        paid: isSupplier ? summary.paymentPaid : summary.paymentReceived,
        returned: isSupplier
          ? summary.purchaseReturnAmount
          : summary.saleReturnAmount,
        outstanding: isSupplier
          ? summary.supplierOutstanding
          : summary.customerOutstanding,
        totalPurchase: isSupplier ? summary.purchaseNet : 0,
        totalPaid: isSupplier ? summary.paymentPaid : 0,
        totalSales: !isSupplier ? summary.salesNet : 0,
        totalReceived: !isSupplier ? summary.paymentReceived : 0,
        remainingAmount: summary.remainingAmount,
      };
    });
};

module.exports = {
  getPartyBalanceSummaries,
  getRoleOutstandingRows,
};
