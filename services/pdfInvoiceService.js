import PDFDocument from "pdfkit";

export default function generatePDF(res, invoice, company, party, type) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });

  doc.pipe(res);

  doc.fontSize(20).text(`${type} INVOICE`, { align: "center" });
  doc.moveDown();

  doc.fontSize(12).text(`Company: ${company.name}`);
  doc.text(`Invoice No: ${invoice.invoiceNumber}`);
  doc.text(`Date: ${invoice.invoiceDate}`);

  doc.moveDown();
  doc.text(`Party: ${party.name}`);

  // Add items loop here...

  doc.end();
}
