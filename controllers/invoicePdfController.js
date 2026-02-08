import SalesInvoice from "../models/SalesInvoice";
import PurchaseInvoice from "../models/PurchaseInvoice";
import Company from "../models/Company";
import Vendor from "../models/Vendor";
import Supplier from "../models/Supplier";
import generatePDF from "../services/pdfInvoiceService";

export const salesInvoicePDF = async (req, res) => {
  try {
    const { id } = req.query;

    const invoice = await SalesInvoice.findById(id);
    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    const company = await Company.findById(invoice.companyId);
    const vendor = await Vendor.findById(invoice.vendorId);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=sales-invoice-${id}.pdf`,
    );

    await generatePDF(res, invoice, company, vendor, "SALE");
  } catch (err) {
    console.error("Sales Invoice PDF Error:", err);
    res.status(500).json({ message: "Failed to generate PDF" });
  }
};

export const purchaseInvoicePDF = async (req, res) => {
  try {
    const { id } = req.query;

    const invoice = await PurchaseInvoice.findById(id);
    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    const company = await Company.findById(invoice.companyId);
    const supplier = await Supplier.findById(invoice.supplierId);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=purchase-invoice-${id}.pdf`,
    );

    await generatePDF(res, invoice, company, supplier, "PURCHASE");
  } catch (err) {
    console.error("Purchase Invoice PDF Error:", err);
    res.status(500).json({ message: "Failed to generate PDF" });
  }
};
