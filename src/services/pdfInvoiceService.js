const PDFDocument = require("pdfkit");

module.exports = function generateInvoicePDF(res, invoice, company, party, type) {
  const doc = new PDFDocument({ margin: 40 });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename=${invoice.invoiceNo || "invoice"}.pdf`,
  );

  doc.pipe(res);

  doc
    .fontSize(18)
    .text(company?.name || "Company", { align: "center" })
    .fontSize(10)
    .text(company?.address || "-", { align: "center" })
    .text(`GSTIN: ${company?.gstin || "-"}`, { align: "center" });

  doc.moveDown();
  doc
    .fontSize(14)
    .text(type === "SALE" ? "TAX INVOICE" : "PURCHASE INVOICE", {
      align: "center",
    });

  doc.moveDown();
  doc.fontSize(10);
  doc.text(`${type === "SALE" ? "Bill To" : "Supplier"}: ${party?.name || "-"}`);
  doc.text(`Address: ${party?.address || "-"}`);
  doc.text(`GSTIN: ${party?.gstNumber || "-"}`);
  doc.moveDown();
  doc.text(`Invoice No: ${invoice.invoiceNo || "-"}`);
  doc.text(`Invoice Date: ${new Date(invoice.invoiceDate).toDateString()}`);
  doc.moveDown();

  doc.fontSize(10).text("Items", { underline: true });
  doc.moveDown(0.5);
  (invoice.items || []).forEach((item, i) => {
    const productName = item.productName || item.productId?.name || "-";
    doc.text(
      `${i + 1}. ${productName} | Qty: ${item.quantity} | Rate: Rs ${item.rate} | Amt: Rs ${item.amount}`,
    );
  });

  doc.moveDown();
  doc.text(`Subtotal: Rs ${invoice.subtotal || 0}`);
  doc.text(`Tax: Rs ${invoice.tax || 0}`);
  doc.fontSize(12).text(`Total: Rs ${invoice.totalAmount || 0}`, {
    underline: true,
  });
  doc.moveDown(2);
  doc.text("Authorised Signatory", { align: "right" });
  doc.end();
};

