const PDFDocument = require("pdfkit");
const PurchaseInvoice = require("../models/PurchaseInvoice");
const SalesInvoice = require("../models/SalesInvoice");
const Payment = require("../models/Payment");
const Party = require("../models/Party");
const ReturnEntry = require("../models/Return");
const { getDateRangeFromQuery } = require("../utils/dateRange");

const isSameDay = (dateValue) => {
  const today = new Date().toISOString().slice(0, 10);
  const d = new Date(dateValue).toISOString().slice(0, 10);
  return d === today;
};

const buildLedger = async ({ companyId, partyId, role, query }) => {
  const invoiceDateQuery = query ? { invoiceDate: query } : {};
  const paymentDateQuery = query ? { paymentDate: query } : {};

  const normalizedRole = String(role || "").toLowerCase();
  const includeSupplier = !normalizedRole || normalizedRole === "all" || normalizedRole === "supplier";
  const includeCustomer =
    !normalizedRole ||
    normalizedRole === "all" ||
    normalizedRole === "customer" ||
    normalizedRole === "vendor";

  const [purchases, sales, payments, returns] = await Promise.all([
    includeSupplier
      ? PurchaseInvoice.find({ companyId, partyId, ...invoiceDateQuery }).select(
          "invoiceDate totalAmount invoiceNo paymentType _id",
        )
      : [],
    includeCustomer
      ? SalesInvoice.find({ companyId, partyId, ...invoiceDateQuery }).select(
          "invoiceDate totalAmount invoiceNo paymentType _id",
        )
      : [],
    Payment.find({
      companyId,
      partyId,
      ...(includeSupplier && !includeCustomer ? { invoiceType: "PURCHASE" } : {}),
      ...(includeCustomer && !includeSupplier ? { invoiceType: "SALE" } : {}),
      ...paymentDateQuery,
    }).select(
      "paymentDate amount paymentMode referenceNo paymentType invoiceType invoiceId _id",
    ),
    ReturnEntry.find({
      companyId,
      partyId,
      ...(query ? { returnDate: query } : {}),
      ...(includeSupplier && !includeCustomer ? { returnType: "PURCHASE_RETURN" } : {}),
      ...(includeCustomer && !includeSupplier ? { returnType: "SALE_RETURN" } : {}),
    }).select("returnDate returnType totalAmount billType billId returnNo"),
  ]);

  const ledger = [];
  const purchaseMap = {};
  const salesMap = {};
  const purchasePayTypeMap = {};
  const salesPayTypeMap = {};

  purchases.forEach((p) => {
    purchaseMap[String(p._id)] = p.invoiceNo || "-";
    purchasePayTypeMap[String(p._id)] = (p.paymentType || "credit").toString().toLowerCase();
  });

  sales.forEach((s) => {
    salesMap[String(s._id)] = s.invoiceNo || "-";
    salesPayTypeMap[String(s._id)] = (s.paymentType || "credit").toString().toLowerCase();
  });

  purchases.forEach((p) => {
    ledger.push({
      date: p.invoiceDate,
      type: "PURCHASE",
      particulars: `Purchase Invoice ${p.invoiceNo}`,
      bill_no: p.invoiceNo || "-",
      paymentType: (p.paymentType || "credit").toString().toLowerCase(),
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
      p.invoiceType === "PURCHASE"
        ? purchaseMap[String(p.invoiceId)] || "-"
        : salesMap[String(p.invoiceId)] || "-";
    ledger.push({
      date: p.paymentDate,
      type: "PAYMENT",
      particulars: `Payment (${p.paymentMode})`,
      bill_no: invoiceNo,
      paymentType: String(p.paymentMode || "").toUpperCase() === "CASH" ? "cash" : "bank",
      partyId,
      debit: isReceived ? 0 : p.amount, // paid
      credit: isReceived ? p.amount : 0, // received
      billId: p.invoiceId,
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
    ledger.push({
      date: r.returnDate,
      type: r.returnType,
      particulars: `${isSaleReturn ? "Sale Return" : "Purchase Return"} ${returnBillNo}`,
      bill_no: returnBillNo,
      paymentType: mappedPaymentType,
      partyId,
      debit: isSaleReturn ? 0 : r.totalAmount, // purchase return
      credit: isSaleReturn ? r.totalAmount : 0, // sale return
      billId: r.billId,
      billType: r.billType,
      canEditBill: false,
    });
  });

  ledger.sort((a, b) => new Date(a.date) - new Date(b.date));
  return ledger;
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
    });

    if (filterType === "cash" || filterType === "bank" || filterType === "credit") {
      ledger = ledger.filter((e) => e.paymentType === filterType);
    } else if (filterType === "party") {
      ledger = ledger.filter((e) => !!e.partyId);
    }

    let balance = party.openingBalance || 0;
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

    const party = await Party.findOne({ _id: partyId, companyId });
    if (!party) {
      return res.status(404).json({ message: "Party not found" });
    }

    const range = getDateRangeFromQuery(req.query);
    const query = range
      ? { $gte: range.fromDate, $lte: range.toDate }
      : null;

    let ledger = await buildLedger({ companyId, partyId, role, query });

    if (filterType === "cash" || filterType === "bank" || filterType === "credit") {
      ledger = ledger.filter((e) => e.paymentType === filterType);
    } else if (filterType === "party") {
      ledger = ledger.filter((e) => !!e.partyId);
    }
    let balance = party.openingBalance || 0;
    ledger = ledger.map((entry) => {
      balance = balance + entry.debit - entry.credit;
      return { ...entry, balance };
    });

    const doc = new PDFDocument({ margin: 30 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=ledger-${party.name.replace(/\s+/g, "-").toLowerCase()}.pdf`,
    );
    doc.pipe(res);

    const titleSuffix =
      filterType && filterType !== "all" ? ` (${filterType.toUpperCase()})` : "";
    doc.fontSize(16).text(`Party Ledger${titleSuffix}`, { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(11).text(`Party: ${party.name}`);
    doc.text(`Opening Balance: ${party.openingBalance || 0}`);
    doc.text(`Closing Balance: ${balance}`);
    doc.moveDown();

    doc.fontSize(10).text("Date | Particulars | Debit | Credit | Balance");
    doc.moveDown(0.3);
    ledger.forEach((row) => {
      const line = `${new Date(row.date).toLocaleDateString("en-IN")} | ${row.particulars} | ${
        row.debit || 0
      } | ${row.credit || 0} | ${row.balance}`;
      doc.text(line);
    });

    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
