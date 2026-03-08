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
          "invoiceDate totalAmount invoiceNo _id",
        )
      : [],
    includeCustomer
      ? SalesInvoice.find({ companyId, partyId, ...invoiceDateQuery }).select(
          "invoiceDate totalAmount invoiceNo _id",
        )
      : [],
    Payment.find({ companyId, partyId, ...paymentDateQuery }).select(
      "paymentDate amount paymentMode referenceNo paymentType invoiceType invoiceId _id",
    ),
    ReturnEntry.find({
      companyId,
      partyId,
      ...(query ? { returnDate: query } : {}),
    }).select("returnDate returnType totalAmount billType billId returnNo"),
  ]);

  const ledger = [];
  const purchaseMap = {};
  const salesMap = {};

  purchases.forEach((p) => {
    purchaseMap[String(p._id)] = p.invoiceNo || "-";
  });

  sales.forEach((s) => {
    salesMap[String(s._id)] = s.invoiceNo || "-";
  });

  purchases.forEach((p) => {
    ledger.push({
      date: p.invoiceDate,
      type: "Purchase",
      particulars: `Purchase Invoice ${p.invoiceNo}`,
      billNumber: p.invoiceNo || "-",
      debit: p.totalAmount,
      credit: 0,
      billId: p._id,
      billType: "PURCHASE",
      canEditBill: isSameDay(p.invoiceDate),
    });
  });

  sales.forEach((s) => {
    ledger.push({
      date: s.invoiceDate,
      type: "Sale",
      particulars: `Sales Invoice ${s.invoiceNo}`,
      billNumber: s.invoiceNo || "-",
      debit: 0,
      credit: s.totalAmount,
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
      type: "Payment",
      particulars: `Payment (${p.paymentMode})`,
      billNumber: invoiceNo,
      debit: isReceived ? 0 : p.amount,
      credit: isReceived ? p.amount : 0,
      billId: p.invoiceId,
      billType: p.invoiceType,
      canEditBill: false,
    });
  });

  returns.forEach((r) => {
    const isSaleReturn = r.returnType === "SALE_RETURN";
    const returnBillNo = r.returnNo || (isSaleReturn ? "SALE_RETURN" : "PURCHASE_RETURN");
    ledger.push({
      date: r.returnDate,
      type: isSaleReturn ? "Sale Return" : "Purchase Return",
      particulars: `${isSaleReturn ? "Sale Return" : "Purchase Return"} ${returnBillNo}`,
      billNumber: returnBillNo,
      debit: isSaleReturn ? 0 : r.totalAmount,
      credit: isSaleReturn ? r.totalAmount : 0,
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
    const role = req.query.role;

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
    const role = req.query.role;

    const party = await Party.findOne({ _id: partyId, companyId });
    if (!party) {
      return res.status(404).json({ message: "Party not found" });
    }

    const range = getDateRangeFromQuery(req.query);
    const query = range
      ? { $gte: range.fromDate, $lte: range.toDate }
      : null;

    let ledger = await buildLedger({ companyId, partyId, role, query });
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

    doc.fontSize(16).text("Party Ledger", { align: "center" });
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
