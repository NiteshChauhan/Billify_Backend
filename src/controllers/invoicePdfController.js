const SalesInvoice = require("../models/SalesInvoice");
const PurchaseInvoice = require("../models/PurchaseInvoice");
const Company = require("../models/Company");
const Party = require("../models/Party");
const { generateInvoicePdf } = require("../services/invoicePdfService");
const { normalizePdfLanguageMode } = require("../utils/pdfLanguage");

exports.salesInvoicePDF = async (req, res) => {
  const invoice = await SalesInvoice.findById(req.params.id).populate(
    "items.productId",
    "name nameAr nameHi sku attributes",
  );
  if (!invoice) {
    return res.status(404).send("Invoice not found");
  }

  const company = await Company.findById(invoice.companyId);
  const party = await Party.findById(invoice.partyId);

  await generateInvoicePdf(res, invoice, company, party, "SALE", {
    languageMode: normalizePdfLanguageMode(
      req.query.languageMode || req.query.language || company?.pdfLanguage,
    ),
  });
};

exports.purchaseInvoicePDF = async (req, res) => {
  const invoice = await PurchaseInvoice.findById(req.params.id).populate(
    "items.productId",
    "name nameAr nameHi sku attributes",
  );
  if (!invoice) {
    return res.status(404).send("Invoice not found");
  }

  const company = await Company.findById(invoice.companyId);
  const party = await Party.findById(invoice.partyId);

  await generateInvoicePdf(res, invoice, company, party, "PURCHASE", {
    languageMode: normalizePdfLanguageMode(
      req.query.languageMode || req.query.language || company?.pdfLanguage,
    ),
  });
};
