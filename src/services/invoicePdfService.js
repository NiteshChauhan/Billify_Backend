const {
  getInvoiceLabels,
  normalizePdfLanguage,
  normalizePdfLanguageMode,
} = require("../utils/pdfLanguage");
const {
  escapeHtml,
  formatDate,
  formatMoney,
  renderHtmlDocument,
} = require("./pdfTemplateUtils");
const { sendPdfResponse } = require("./pdfBrowser");

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

const getLanguageModeMeta = (languageMode) => {
  const mode = normalizePdfLanguageMode(languageMode);
  return {
    mode,
    baseLanguage: normalizePdfLanguage(mode),
    isArabicOnly: mode === "ar",
    isHindiOnly: mode === "hi",
    isEnglishArabic: mode === "en_ar",
    isEnglishHindi: mode === "en_hi",
    isBilingual: mode === "en_ar" || mode === "en_hi",
    secondaryLanguage: mode === "en_ar" ? "ar" : mode === "en_hi" ? "hi" : null,
  };
};

const getEnglishProductName = (item) =>
  item.productNameEn ||
  item.productName ||
  item.productId?.name ||
  "-";

const getArabicProductName = (item) =>
  item.productNameAr ||
  item.productId?.nameAr ||
  "";

const getHindiProductName = (item) =>
  item.productNameHi ||
  item.productId?.nameHi ||
  "";

const getProductDisplayName = (item, languageMode) => {
  const meta = getLanguageModeMeta(languageMode);
  const englishName = getEnglishProductName(item);
  const arabicName = getArabicProductName(item) || englishName;
  const hindiName = getHindiProductName(item) || englishName;

  if (meta.isArabicOnly) {
    return {
      primary: arabicName,
      primaryClass: "lang-ar",
      secondary: "",
      secondaryClass: "",
    };
  }

  if (meta.isHindiOnly) {
    return {
      primary: hindiName,
      primaryClass: "lang-hi",
      secondary: "",
      secondaryClass: "",
    };
  }

  if (meta.isEnglishArabic) {
    return {
      primary: englishName,
      primaryClass: "",
      secondary: arabicName,
      secondaryClass: "lang-ar",
    };
  }

  if (meta.isEnglishHindi) {
    return {
      primary: englishName,
      primaryClass: "",
      secondary: hindiName,
      secondaryClass: "lang-hi",
    };
  }

  return {
    primary: englishName,
    primaryClass: "",
    secondary: "",
    secondaryClass: "",
  };
};

const renderInvoiceRows = (invoice, company, languageMode, labels) =>
  (invoice.items || [])
    .map((item, index) => {
      const name = getProductDisplayName(item, languageMode);
      const packing =
        item.packing ||
        item.productId?.attributes?.packing ||
        item.productId?.attributes?.Packing ||
        "-";

      return `
        <tr>
          <td class="col-index">${index + 1}</td>
          <td class="col-description">
            <div class="desc-main ${name.primaryClass}">${escapeHtml(name.primary)}</div>
            ${
              name.secondary
                ? `<div class="desc-sub ${name.secondaryClass}">${escapeHtml(name.secondary)}</div>`
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

const renderCompanyHeader = (company, meta, labels, titleMarkup) => {
  const showEnglishBlock = !meta.isArabicOnly;
  const showArabicBlock = meta.isArabicOnly || meta.isEnglishArabic;

  return `
    <header class="invoice-header ${showArabicBlock ? "three-col" : "two-col"}">
      ${
        showEnglishBlock
          ? `
            <div class="company-block company-left">
              <div class="company-name">${escapeHtml(company?.name || "Company")}</div>
              <div class="company-address">${escapeHtml(company?.address || "-")}</div>
            </div>
          `
          : ""
      }
      <div class="company-block company-center">
        <div class="contact-pill">${escapeHtml(labels.phone)} ${escapeHtml(company?.mobile || "-")}</div>
        <div class="whatsapp-line">${escapeHtml(labels.whatsapp)} ${escapeHtml(company?.whatsapp || company?.mobile || "-")}</div>
        <div class="title-pill">${titleMarkup}</div>
      </div>
      ${
        showArabicBlock
          ? `
            <div class="company-block company-right lang-ar">
              <div class="company-name">${escapeHtml(company?.nameAr || company?.name || "-")}</div>
              <div class="company-address">${escapeHtml(company?.addressAr || company?.address || "-")}</div>
            </div>
          `
          : ""
      }
    </header>
  `;
};

const getTermsMarkup = (labels, meta) => {
  if (meta.isEnglishArabic) {
    return `
      <div class="terms-en">${escapeHtml(getInvoiceLabels("en").termsConfirmation)}</div>
      <div class="terms-ar lang-ar">${escapeHtml(getInvoiceLabels("ar").termsConfirmation)}</div>
    `;
  }

  if (meta.isEnglishHindi) {
    return `
      <div class="terms-en">${escapeHtml(getInvoiceLabels("en").termsConfirmation)}</div>
      <div class="terms-hi lang-hi">${escapeHtml(getInvoiceLabels("hi").termsConfirmation)}</div>
    `;
  }

  if (meta.isArabicOnly) {
    return `<div class="terms-ar lang-ar">${escapeHtml(labels.termsConfirmation)}</div>`;
  }

  if (meta.isHindiOnly) {
    return `<div class="terms-hi lang-hi">${escapeHtml(labels.termsConfirmation)}</div>`;
  }

  return `<div class="terms-en">${escapeHtml(labels.termsConfirmation)}</div>`;
};

const renderStackedLabel = (primary, secondary = "", secondaryClass = "") => `
  <div class="label-stack">
    <div class="label-primary">${escapeHtml(primary)}</div>
    ${secondary ? `<div class="label-secondary ${secondaryClass}">${escapeHtml(secondary)}</div>` : ""}
  </div>
`;

const buildInvoiceHtml = ({ invoice, company, party, type, languageMode }) => {
  const meta = getLanguageModeMeta(languageMode);
  const labels = getInvoiceLabels(meta.mode);
  const englishLabels = getInvoiceLabels("en");
  const arabicLabels = getInvoiceLabels("ar");
  const hindiLabels = getInvoiceLabels("hi");
  const title = type === "SALE" ? labels.invoiceTitleSale : labels.invoiceTitlePurchase;
  const grossAmount = Number(invoice.totalAmount || 0);
  const discount = 0;
  const netAmount = Number(invoice.totalAmount || 0);
  const customerTel = invoice.customerTel || party?.phone || "-";
  const customerAttn = invoice.customerAttn || party?.name || "-";
  const customerBranch = invoice.customerBranch || "-";
  const pageText = getPageText(labels);
  const englishTitle = type === "SALE" ? englishLabels.invoiceTitleSale : englishLabels.invoiceTitlePurchase;
  const titleSecondary = meta.isEnglishHindi
    ? (type === "SALE" ? hindiLabels.invoiceTitleSale : hindiLabels.invoiceTitlePurchase)
    : (type === "SALE" ? arabicLabels.invoiceTitleSale : arabicLabels.invoiceTitlePurchase);
  const customerPanelSecondary = meta.isEnglishHindi
    ? hindiLabels.customerDetails
    : arabicLabels.customerDetails;
  const invoicePanelSecondary = meta.isEnglishHindi
    ? hindiLabels.invoiceDetails
    : arabicLabels.invoiceDetails;
  const descriptionSecondary = meta.isEnglishHindi
    ? hindiLabels.description
    : arabicLabels.description;
  const packingSecondary = meta.isEnglishHindi
    ? hindiLabels.packing
    : arabicLabels.packing;
  const qtySecondary = meta.isEnglishHindi
    ? hindiLabels.qty
    : arabicLabels.qty;
  const unitPriceSecondary = meta.isEnglishHindi
    ? hindiLabels.unitPrice
    : arabicLabels.unitPrice;
  const amountSecondary = meta.isEnglishHindi
    ? hindiLabels.amount
    : arabicLabels.amount;
  const titleMarkup =
    meta.isArabicOnly || meta.isHindiOnly
      ? escapeHtml(title)
      : `
          <div class="title-main">${escapeHtml(englishTitle)}</div>
          <div class="title-sub ${meta.isEnglishHindi ? "lang-hi" : "lang-ar"}">${escapeHtml(titleSecondary)}</div>
        `;
  const headerSecondaryClass = meta.isEnglishHindi ? "lang-hi" : "lang-ar";
  const invoiceDateTime = invoice.invoiceDate
    ? new Date(invoice.invoiceDate)
    : new Date();
  const footerDate = invoiceDateTime.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const footerTime = invoiceDateTime.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const body = `
    <section class="invoice-sheet ${meta.isArabicOnly ? "rtl-doc" : ""}">
      ${renderCompanyHeader(company, meta, labels, titleMarkup)}

      <section class="top-panels">
        <div class="panel">
          <div class="panel-title">
            ${
              meta.isArabicOnly || meta.isHindiOnly
                ? escapeHtml(labels.customerDetails)
                : renderStackedLabel(englishLabels.customerDetails, customerPanelSecondary, headerSecondaryClass)
            }
          </div>
          <div class="detail-grid">
            <div class="detail-row"><span class="label">${escapeHtml(labels.ms)}</span><span class="value strong">${escapeHtml(party?.name || "-")}</span></div>
            <div class="detail-row"><span class="label">${escapeHtml(labels.branch)}</span><span class="value">${escapeHtml(customerBranch)}</span></div>
            <div class="detail-row"><span class="label">${escapeHtml(labels.address)}</span><span class="value">${escapeHtml(party?.address || "-")}</span></div>
            <div class="detail-row"><span class="label">${escapeHtml(labels.attn)}</span><span class="value">${escapeHtml(customerAttn)}</span></div>
            <div class="detail-row"><span class="label">${escapeHtml(labels.tel)}</span><span class="value">${escapeHtml(customerTel)}</span></div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-title">
            ${
              meta.isArabicOnly || meta.isHindiOnly
                ? escapeHtml(labels.invoiceDetails)
                : renderStackedLabel(englishLabels.invoiceDetails, invoicePanelSecondary, headerSecondaryClass)
            }
          </div>
          <div class="detail-grid">
            <div class="detail-row split"><span class="label">${escapeHtml(labels.invoiceNo)}</span><span class="value strong">${escapeHtml(invoice.invoiceNo || "-")}</span></div>
            <div class="detail-row split"><span class="label">${escapeHtml(labels.invoiceDate)}</span><span class="value">${escapeHtml(formatDate(invoice.invoiceDate))}</span></div>
            <div class="detail-row split"><span class="label">${escapeHtml(labels.salesman)}</span><span class="value">${escapeHtml(invoice.salesman || "-")}</span></div>
            <div class="detail-row split"><span class="label">${escapeHtml(labels.paymentType)}</span><span class="value">${escapeHtml(String(invoice.paymentType || "credit").toUpperCase())}</span></div>
            <div class="detail-row split"><span class="label">${escapeHtml(labels.lpoNo)}</span><span class="value">${escapeHtml(invoice.lpoNo || "-")}</span></div>
          </div>
        </div>
      </section>

      <section class="items-table-wrap">
        <table class="items-table">
          <thead>
            <tr>
              <th class="col-index">${escapeHtml(labels.srNo)}</th>
              <th class="col-description">
                ${
                  meta.isArabicOnly || meta.isHindiOnly
                    ? escapeHtml(labels.description)
                    : renderStackedLabel(englishLabels.description, descriptionSecondary, headerSecondaryClass)
                }
              </th>
              <th class="col-pack">
                ${
                  meta.isArabicOnly || meta.isHindiOnly
                    ? escapeHtml(labels.packing)
                    : renderStackedLabel(englishLabels.packing, packingSecondary, headerSecondaryClass)
                }
              </th>
              <th class="col-qty">
                ${
                  meta.isArabicOnly || meta.isHindiOnly
                    ? escapeHtml(labels.qty)
                    : renderStackedLabel(englishLabels.qty, qtySecondary, headerSecondaryClass)
                }
              </th>
              <th class="col-rate">
                ${
                  meta.isArabicOnly || meta.isHindiOnly
                    ? escapeHtml(labels.unitPrice)
                    : renderStackedLabel(englishLabels.unitPrice, unitPriceSecondary, headerSecondaryClass)
                }
              </th>
              <th class="col-amount">
                ${
                  meta.isArabicOnly || meta.isHindiOnly
                    ? escapeHtml(labels.amount)
                    : renderStackedLabel(englishLabels.amount, amountSecondary, headerSecondaryClass)
                }
              </th>
            </tr>
          </thead>
          <tbody>
            ${renderInvoiceRows(invoice, company, meta.mode, labels)}
            <tr class="filler-row"><td colspan="6"></td></tr>
          </tbody>
        </table>
      </section>

      <section class="bottom-grid">
        <div class="words-box">
          <div class="box-label">${escapeHtml(labels.amountInWords)} :</div>
          <div class="box-value">${escapeHtml(amountInWords(company, netAmount))}</div>
        </div>
        <div class="totals-box">
          <div class="total-line"><span>${escapeHtml(labels.grossAmount)}</span><strong>${escapeHtml(formatMoney(company, grossAmount))}</strong></div>
          <div class="total-line"><span>${escapeHtml(labels.discount)}</span><strong>${escapeHtml(formatMoney(company, discount))}</strong></div>
          <div class="total-line total-emphasis"><span>${escapeHtml(labels.netAmount)}</span><strong>${escapeHtml(formatMoney(company, netAmount))}</strong></div>
        </div>
      </section>

      <section class="terms-section">
        ${getTermsMarkup(labels, meta)}
      </section>

      <section class="signature-grid">
        <div class="signature-box">
          <div class="signature-title">${escapeHtml(labels.preparedBy)}</div>
          <div class="signature-value">${escapeHtml(invoice.salesman || "Default")}</div>
        </div>
        <div class="signature-box">
          <div class="signature-title">${escapeHtml(labels.deliveredBy)}</div>
          <div class="signature-value">Default</div>
        </div>
        <div class="receiver-box">
          <div class="receiver-row"><span>${escapeHtml(labels.receiversName)} :</span><span class="line"></span></div>
          <div class="receiver-row"><span>${escapeHtml(labels.receiversSignature)} :</span><span class="line"></span></div>
          <div class="receiver-row"><span>${escapeHtml(labels.date)} :</span><span class="line"></span></div>
        </div>
      </section>

      <footer class="page-footer">
        <div class="footer-left">
          <span>${escapeHtml(footerDate)}</span>
          <span>${escapeHtml(footerTime)}</span>
        </div>
        <div class="footer-right">${escapeHtml(pageText)}</div>
      </footer>
    </section>
  `;

  return renderHtmlDocument({
    title,
    language: meta.baseLanguage,
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
        gap: 12px;
        align-items: start;
        margin-bottom: 12px;
      }
      .invoice-header.three-col {
        grid-template-columns: 1.1fr 0.9fr 1.1fr;
      }
      .invoice-header.two-col {
        grid-template-columns: 1.2fr 1fr;
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
        padding: 5px 18px 6px;
        font-weight: 700;
        line-height: 1.35;
        white-space: pre-wrap;
        min-width: 210px;
      }
      .title-main {
        font-size: 13px;
      }
      .title-sub {
        margin-top: 2px;
        font-size: 12px;
      }
      .top-panels {
        display: grid;
        grid-template-columns: 1fr 0.78fr;
        gap: 0;
        margin-bottom: 8px;
      }
      .panel {
        border: 1px solid var(--line);
        min-height: 146px;
      }
      .panel + .panel {
        border-left: none;
      }
      .panel-title {
        display: grid;
        place-items: center;
        padding: 3px 10px 4px;
        border-bottom: 1px solid var(--line);
        font-weight: 700;
        text-align: center;
      }
      .label-stack {
        display: grid;
        gap: 1px;
        justify-items: center;
      }
      .label-primary {
        font-size: 11px;
        line-height: 1.15;
      }
      .label-secondary {
        font-size: 10px;
        line-height: 1.15;
      }
      .detail-grid {
        padding: 8px 12px 10px;
        display: grid;
        gap: 7px;
      }
      .detail-row {
        display: grid;
        grid-template-columns: 72px 1fr;
        gap: 8px;
        align-items: baseline;
      }
      .detail-row.split {
        grid-template-columns: 96px 1fr;
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
        padding: 5px 6px;
        vertical-align: top;
      }
      .items-table th {
        text-align: center;
        font-weight: 700;
        line-height: 1.2;
      }
      .col-index { width: 4%; text-align: center; }
      .col-description { width: 52%; }
      .col-pack { width: 8%; text-align: center; }
      .col-qty { width: 8%; }
      .col-rate { width: 13%; }
      .col-amount { width: 15%; }
      .num { text-align: right; white-space: nowrap; }
      .desc-main {
        font-weight: 600;
        line-height: 1.35;
        white-space: pre-wrap;
      }
      .desc-sub {
        margin-top: 4px;
        color: #475569;
        line-height: 1.35;
        white-space: pre-wrap;
      }
      .items-table-wrap { margin-bottom: 10px; }
      .filler-row td {
        height: 500px;
      }
      .empty-row {
        text-align: center;
        color: #64748b;
      }
      .bottom-grid {
        display: grid;
        grid-template-columns: 1.22fr 0.68fr;
        gap: 8px;
        margin-bottom: 8px;
      }
      .words-box,
      .totals-box {
        border: 1px solid var(--line);
      }
      .box-label {
        padding: 5px 8px;
        border-bottom: 1px solid var(--line);
        font-weight: 700;
        line-height: 1.35;
      }
      .box-value {
        padding: 8px 8px;
        min-height: 32px;
      }
      .total-line {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        padding: 6px 10px;
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
        margin: 8px 0 14px;
        line-height: 1.55;
      }
      .terms-en,
      .terms-hi,
      .terms-ar {
        margin-bottom: 4px;
      }
      .signature-grid {
        display: grid;
        grid-template-columns: 1fr 1fr 1.4fr;
        gap: 18px;
        align-items: start;
      }
      .signature-box {
        min-height: 102px;
      }
      .signature-title {
        margin-bottom: 22px;
        line-height: 1.35;
      }
      .signature-value {
        min-height: 18px;
      }
      .receiver-box {
        border: 1px solid var(--line);
        padding: 10px 12px;
        min-height: 118px;
      }
      .receiver-row {
        display: grid;
        grid-template-columns: 150px 1fr;
        gap: 8px;
        align-items: center;
        margin: 10px 0;
      }
      .line {
        border-bottom: 1px solid var(--line);
        min-height: 16px;
      }
      .page-footer {
        margin-top: 10px;
        display: flex;
        justify-content: space-between;
        align-items: end;
        font-size: 10px;
        color: #475569;
      }
      .footer-left {
        display: flex;
        gap: 36px;
        align-items: center;
      }
      .footer-right {
        text-align: right;
      }
      .rtl-doc .detail-row {
        grid-template-columns: 1fr 72px;
      }
      .rtl-doc .detail-row.split {
        grid-template-columns: 1fr 96px;
      }
      .rtl-doc .detail-row .label,
      .rtl-doc .detail-row .value,
      .rtl-doc .receiver-row,
      .rtl-doc .signature-box,
      .rtl-doc .words-box,
      .rtl-doc .totals-box {
        text-align: right;
      }
      .rtl-doc .footer-left {
        gap: 24px;
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
  const languageMode = normalizePdfLanguageMode(options.languageMode || options.language || "en");
  const html = buildInvoiceHtml({ invoice, company, party, type, languageMode });
  const safeName = String(invoice.invoiceNo || "invoice").replace(/[^\w.-]+/g, "-");
  await sendPdfResponse(res, {
    html,
    filename: `${safeName}.pdf`,
  });
};

module.exports = {
  buildInvoiceHtml,
  generateInvoicePdf,
  getProductDisplayName,
};
