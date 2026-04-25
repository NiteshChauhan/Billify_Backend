const { getPdfLabels, normalizePdfLanguage } = require("../utils/pdfLanguage");
const {
  escapeHtml,
  formatDate,
  formatMoney,
  renderHtmlDocument,
} = require("./pdfTemplateUtils");
const { sendPdfResponse } = require("./pdfBrowser");

const getSelectedProductName = (item, language) => {
  if (language === "ar") {
    return (
      item.productNameAr ||
      item.productId?.nameAr ||
      item.productName ||
      item.productId?.name ||
      "-"
    );
  }

  if (language === "hi") {
    return (
      item.productNameHi ||
      item.productId?.nameHi ||
      item.productName ||
      item.productId?.name ||
      "-"
    );
  }

  return item.productName || item.productId?.name || "-";
};

const getSecondaryText = (language, selectedText, alternateText) =>
  language === "ar" ? alternateText || "" : selectedText || alternateText || "";

const getPageText = (labels) => `${labels.page} 1 ${labels.of} 1`;

const smallNumberToWords = (value) => {
  const ones = [
    "Zero",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  const number = Number(value || 0);
  if (number < 20) return ones[number];
  if (number < 100) {
    return `${tens[Math.floor(number / 10)]}${number % 10 ? ` ${ones[number % 10]}` : ""}`;
  }
  if (number < 1000) {
    return `${ones[Math.floor(number / 100)]} Hundred${number % 100 ? ` ${smallNumberToWords(number % 100)}` : ""}`;
  }
  return "";
};

const numberToWords = (value) => {
  const number = Math.floor(Number(value || 0));
  if (!number) return "Zero";

  const scales = [
    { value: 1000000000, label: "Billion" },
    { value: 1000000, label: "Million" },
    { value: 1000, label: "Thousand" },
  ];

  let remaining = number;
  const parts = [];

  for (const scale of scales) {
    if (remaining >= scale.value) {
      const chunk = Math.floor(remaining / scale.value);
      parts.push(`${smallNumberToWords(chunk)} ${scale.label}`);
      remaining %= scale.value;
    }
  }

  if (remaining > 0) {
    parts.push(smallNumberToWords(remaining));
  }

  return parts.join(" ");
};

const amountInWords = (company, amount) => {
  const decimals = Number(company?.currencyDecimals ?? 2);
  const currency = String(company?.currencySymbol || "Rs").trim();
  const absolute = Number(amount || 0);
  const whole = Math.floor(absolute);
  const fractionalBase = 10 ** decimals;
  const fractional = Math.round((absolute - whole) * fractionalBase);
  const paddedFractional = String(fractional).padStart(decimals, "0");
  return `${currency} ${numberToWords(whole)} And ${paddedFractional}/${fractionalBase} Only`;
};

const renderInvoiceRows = (invoice, company, language, labels) =>
  (invoice.items || [])
    .map((item, index) => {
      const productName = getSelectedProductName(item, language);
      const packing = item.packing || item.productId?.attributes?.packing || item.productId?.attributes?.Packing || "-";
      return `
        <tr>
          <td class="col-index">${index + 1}</td>
          <td class="col-description">
            <div class="desc-main">${escapeHtml(productName)}</div>
            ${
              language !== "ar" && item.productNameAr
                ? `<div class="desc-sub lang-ar">${escapeHtml(item.productNameAr)}</div>`
                : ""
            }
          </td>
          <td class="col-pack">${escapeHtml(String(packing || "-"))}</td>
          <td class="col-qty num">${escapeHtml(Number(item.quantity || 0).toFixed(2))}</td>
          <td class="col-rate num">${escapeHtml(formatMoney(company, item.rate))}</td>
          <td class="col-amount num">${escapeHtml(formatMoney(company, item.amount))}</td>
        </tr>
      `;
    })
    .join("") ||
  `<tr><td colspan="6" class="empty-row">${escapeHtml(labels.items)}</td></tr>`;

const bilingualHeaderCell = (primary, secondary = "") => `
  <div class="th-main">${escapeHtml(primary)}</div>
  ${secondary ? `<div class="th-sub lang-ar">${escapeHtml(secondary)}</div>` : ""}
`;

const buildInvoiceHtml = ({ invoice, company, party, type, language }) => {
  const normalizedLanguage = normalizePdfLanguage(language);
  const t = getPdfLabels(normalizedLanguage);
  const englishLabels = getPdfLabels("en");
  const arabicLabels = getPdfLabels("ar");
  const title = type === "SALE" ? t.invoiceTitleSale : t.invoiceTitlePurchase;
  const titleSecondary = normalizedLanguage === "ar" ? englishLabels.invoiceTitleSale : arabicLabels.invoiceTitleSale;
  const grossAmount = Number(invoice.totalAmount || 0);
  const discount = 0;
  const netAmount = Number(invoice.totalAmount || 0);
  const phoneText = company?.mobile || "-";
  const whatsappText = company?.whatsapp || company?.mobile || "-";
  const customerTel = invoice.customerTel || party?.phone || "-";
  const customerAttn = invoice.customerAttn || party?.name || "-";
  const customerBranch = invoice.customerBranch || "-";
  const pageText = getPageText(t);

  const body = `
    <section class="invoice-sheet ${normalizedLanguage === "ar" ? "rtl-doc" : ""}">
      <header class="invoice-header">
        <div class="company-block company-left">
          <div class="company-name">${escapeHtml(company?.name || "Company")}</div>
          <div class="company-address">${escapeHtml(company?.address || "-")}</div>
        </div>
        <div class="company-block company-center">
          <div class="contact-pill">PHONE ${escapeHtml(phoneText)}</div>
          <div class="whatsapp-line">WHATSAPP ${escapeHtml(whatsappText)}</div>
          <div class="title-pill">
            <div>${escapeHtml(title)}</div>
            <div class="lang-ar">${escapeHtml(titleSecondary)}</div>
          </div>
        </div>
        <div class="company-block company-right lang-ar">
          <div class="company-name">${escapeHtml(company?.nameAr || company?.name || "-")}</div>
          <div class="company-address">${escapeHtml(company?.addressAr || company?.address || "-")}</div>
        </div>
      </header>

      <section class="top-panels">
        <div class="panel">
          <div class="panel-title">
            <span>${escapeHtml(t.customerDetails)}</span>
            <span class="lang-ar">${escapeHtml(getSecondaryText(normalizedLanguage, arabicLabels.customerDetails, englishLabels.customerDetails))}</span>
          </div>
          <div class="detail-grid">
            <div class="detail-row"><span class="label">${escapeHtml(t.ms)}</span><span class="value strong">${escapeHtml(party?.name || "-")}</span></div>
            <div class="detail-row"><span class="label">${escapeHtml(t.branch)}</span><span class="value">${escapeHtml(customerBranch)}</span></div>
            <div class="detail-row"><span class="label">${escapeHtml(t.address)}</span><span class="value">${escapeHtml(party?.address || "-")}</span></div>
            <div class="detail-row"><span class="label">${escapeHtml(t.attn)}</span><span class="value">${escapeHtml(customerAttn)}</span></div>
            <div class="detail-row"><span class="label">${escapeHtml(t.tel)}</span><span class="value">${escapeHtml(customerTel)}</span></div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-title">
            <span>${escapeHtml(t.invoiceDetails)}</span>
            <span class="lang-ar">${escapeHtml(getSecondaryText(normalizedLanguage, arabicLabels.invoiceDetails, englishLabels.invoiceDetails))}</span>
          </div>
          <div class="detail-grid">
            <div class="detail-row split"><span class="label">${escapeHtml(t.invoiceNo)}</span><span class="value strong">${escapeHtml(invoice.invoiceNo || "-")}</span></div>
            <div class="detail-row split"><span class="label">${escapeHtml(t.invoiceDate)}</span><span class="value">${escapeHtml(formatDate(invoice.invoiceDate))}</span></div>
            <div class="detail-row split"><span class="label">${escapeHtml(t.salesman)}</span><span class="value">${escapeHtml(invoice.salesman || "-")}</span></div>
            <div class="detail-row split"><span class="label">${escapeHtml(t.paymentType)}</span><span class="value">${escapeHtml(String(invoice.paymentType || "credit").toUpperCase())}</span></div>
            <div class="detail-row split"><span class="label">${escapeHtml(t.lpoNo)}</span><span class="value">${escapeHtml(invoice.lpoNo || "-")}</span></div>
          </div>
        </div>
      </section>

      <section class="items-table-wrap">
        <table class="items-table">
          <thead>
            <tr>
              <th class="col-index">${bilingualHeaderCell(t.srNo, "#")}</th>
              <th class="col-description">${bilingualHeaderCell(t.description, t.descriptionArabic)}</th>
              <th class="col-pack">${bilingualHeaderCell(t.packing, t.packingArabic)}</th>
              <th class="col-qty">${bilingualHeaderCell(t.qty, t.qtyArabic)}</th>
              <th class="col-rate">${bilingualHeaderCell(t.unitPrice, t.unitPriceArabic)}</th>
              <th class="col-amount">${bilingualHeaderCell(t.amount, t.amountArabic)}</th>
            </tr>
          </thead>
          <tbody>
            ${renderInvoiceRows(invoice, company, normalizedLanguage, t)}
            <tr class="filler-row"><td colspan="6"></td></tr>
          </tbody>
        </table>
      </section>

      <section class="bottom-grid">
        <div class="words-box">
          <div class="box-label">${escapeHtml(t.amountInWords)} :</div>
          <div class="box-value">${escapeHtml(amountInWords(company, netAmount))}</div>
        </div>
        <div class="totals-box">
          <div class="total-line"><span>${escapeHtml(t.grossAmount)}</span><strong>${escapeHtml(formatMoney(company, grossAmount))}</strong></div>
          <div class="total-line"><span>${escapeHtml(t.discount)}</span><strong>${escapeHtml(formatMoney(company, discount))}</strong></div>
          <div class="total-line total-emphasis"><span>${escapeHtml(t.netAmount)}</span><strong>${escapeHtml(formatMoney(company, netAmount))}</strong></div>
        </div>
      </section>

      <section class="terms-section">
        <div class="terms-ar lang-ar">${escapeHtml(t.termsConfirmationArabic)}</div>
        <div class="terms-en">${escapeHtml(t.termsConfirmation)}</div>
      </section>

      <section class="signature-grid">
        <div class="signature-box">
          <div class="signature-title">${escapeHtml(t.preparedBy)}</div>
          <div class="signature-value">${escapeHtml(invoice.salesman || "Default")}</div>
        </div>
        <div class="signature-box">
          <div class="signature-title">${escapeHtml(t.deliveredBy)}</div>
          <div class="signature-value">Default</div>
        </div>
        <div class="receiver-box">
          <div class="receiver-row"><span>${escapeHtml(t.receiversName)} :</span><span class="line"></span></div>
          <div class="receiver-row"><span>${escapeHtml(t.receiversSignature)} :</span><span class="line"></span></div>
          <div class="receiver-row"><span>${escapeHtml(t.date)} :</span><span class="line"></span></div>
        </div>
      </section>

      <footer class="page-footer">${escapeHtml(pageText)}</footer>
    </section>
  `;

  return renderHtmlDocument({
    title,
    language: normalizedLanguage,
    body,
    extraCss: `
      body {
        padding: 8mm 8mm 10mm;
        font-size: 11px;
      }
      .invoice-sheet {
        border: 1px solid #9ca3af;
        padding: 10px 10px 14px;
      }
      .invoice-header {
        display: grid;
        grid-template-columns: 1.1fr 0.9fr 1.1fr;
        gap: 12px;
        align-items: start;
        margin-bottom: 12px;
      }
      .company-block {
        min-height: 76px;
      }
      .company-left { text-align: left; }
      .company-center { text-align: center; }
      .company-right { text-align: right; }
      .company-name {
        font-size: 20px;
        font-weight: 700;
        line-height: 1.2;
      }
      .company-address {
        margin-top: 6px;
        color: #334155;
        white-space: pre-line;
      }
      .contact-pill {
        display: inline-block;
        padding: 6px 12px;
        border: 1px solid var(--line);
        border-radius: 3px;
        font-weight: 700;
        margin-bottom: 6px;
      }
      .whatsapp-line {
        font-weight: 600;
        margin-bottom: 8px;
      }
      .title-pill {
        display: inline-block;
        border: 1px solid var(--line);
        border-radius: 6px;
        padding: 6px 18px;
        font-weight: 700;
        line-height: 1.25;
      }
      .top-panels {
        display: grid;
        grid-template-columns: 1fr 0.78fr;
        gap: 0;
        margin-bottom: 10px;
      }
      .panel {
        border: 1px solid var(--line);
        min-height: 152px;
      }
      .panel + .panel {
        border-left: none;
      }
      .panel-title {
        display: flex;
        justify-content: center;
        gap: 12px;
        padding: 4px 10px;
        border-bottom: 1px solid var(--line);
        font-weight: 700;
      }
      .detail-grid {
        padding: 8px 12px;
        display: grid;
        gap: 8px;
      }
      .detail-row {
        display: grid;
        grid-template-columns: 84px 1fr;
        gap: 8px;
        align-items: baseline;
      }
      .detail-row.split {
        grid-template-columns: 110px 1fr;
      }
      .label {
        color: #334155;
      }
      .value.strong {
        font-weight: 700;
      }
      .items-table {
        table-layout: fixed;
        border: 1px solid var(--line);
      }
      .items-table th,
      .items-table td {
        border: 1px solid var(--line);
        padding: 6px 6px;
        vertical-align: top;
      }
      .items-table th {
        text-align: center;
        font-weight: 700;
      }
      .th-main {
        font-size: 11px;
      }
      .th-sub {
        font-size: 10px;
        color: #475569;
        margin-top: 2px;
      }
      .col-index { width: 4%; text-align: center; }
      .col-description { width: 50%; }
      .col-pack { width: 10%; text-align: center; }
      .col-qty { width: 9%; }
      .col-rate { width: 13%; }
      .col-amount { width: 14%; }
      .num { text-align: right; white-space: nowrap; }
      .desc-main { font-weight: 600; }
      .desc-sub { margin-top: 2px; color: #475569; }
      .items-table-wrap { margin-bottom: 10px; }
      .filler-row td {
        height: 430px;
      }
      .empty-row {
        text-align: center;
        color: #64748b;
      }
      .bottom-grid {
        display: grid;
        grid-template-columns: 1.2fr 0.7fr;
        gap: 10px;
        margin-bottom: 10px;
      }
      .words-box,
      .totals-box {
        border: 1px solid var(--line);
      }
      .box-label {
        padding: 6px 8px;
        border-bottom: 1px solid var(--line);
        font-weight: 700;
      }
      .box-value {
        padding: 10px 8px;
        min-height: 44px;
      }
      .total-line {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        padding: 8px 10px;
        border-bottom: 1px solid var(--line);
      }
      .total-line:last-child {
        border-bottom: none;
      }
      .total-emphasis {
        font-weight: 700;
      }
      .terms-section {
        text-align: center;
        margin: 12px 0 18px;
        line-height: 1.6;
      }
      .terms-ar {
        margin-bottom: 4px;
      }
      .signature-grid {
        display: grid;
        grid-template-columns: 1fr 1fr 1.4fr;
        gap: 20px;
        align-items: start;
      }
      .signature-box {
        min-height: 90px;
      }
      .signature-title {
        margin-bottom: 28px;
      }
      .signature-value {
        min-height: 18px;
      }
      .receiver-box {
        border: 1px solid var(--line);
        padding: 10px 12px;
        min-height: 110px;
      }
      .receiver-row {
        display: grid;
        grid-template-columns: 145px 1fr;
        gap: 8px;
        align-items: center;
        margin: 8px 0;
      }
      .line {
        border-bottom: 1px solid var(--line);
        min-height: 16px;
      }
      .page-footer {
        margin-top: 10px;
        text-align: right;
        font-size: 10px;
        color: #475569;
      }
      .rtl-doc .detail-row {
        grid-template-columns: 1fr 84px;
      }
      .rtl-doc .detail-row.split {
        grid-template-columns: 1fr 110px;
      }
      .rtl-doc .detail-row .label,
      .rtl-doc .detail-row .value,
      .rtl-doc .receiver-row,
      .rtl-doc .signature-box,
      .rtl-doc .words-box,
      .rtl-doc .totals-box {
        text-align: right;
      }
      @media print {
        body {
          padding: 0;
        }
      }
    `,
  });
};

const generateInvoicePdf = async (res, invoice, company, party, type, options = {}) => {
  const language = normalizePdfLanguage(options.language || "en");
  const html = buildInvoiceHtml({ invoice, company, party, type, language });
  const safeName = String(invoice.invoiceNo || "invoice").replace(/[^\w.-]+/g, "-");
  await sendPdfResponse(res, {
    html,
    filename: `${safeName}.pdf`,
  });
};

module.exports = {
  buildInvoiceHtml,
  generateInvoicePdf,
};
