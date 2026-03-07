const SalesInvoice = require("../models/SalesInvoice");
const PurchaseInvoice = require("../models/PurchaseInvoice");
const Company = require("../models/Company");
const Party = require("../models/Party");
const generatePDF = require("../services/pdfInvoiceService");

exports.salesInvoicePDF = async (req, res) => {
  const invoice = await SalesInvoice.findById(req.params.id).populate("items.productId", "name");
  if (!invoice) {
    return res.status(404).send("Invoice not found");
  }

  const company = await Company.findById(invoice.companyId);
  const party = await Party.findById(invoice.partyId);

  generatePDF(res, invoice, company, party, "SALE");
};

exports.purchaseInvoicePDF = async (req, res) => {
  const invoice = await PurchaseInvoice.findById(req.params.id).populate("items.productId", "name");
  if (!invoice) {
    return res.status(404).send("Invoice not found");
  }

  const company = await Company.findById(invoice.companyId);
  const party = await Party.findById(invoice.partyId);

  generatePDF(res, invoice, company, party, "PURCHASE");
};
