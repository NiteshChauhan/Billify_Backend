const { getPdfLabels } = require("../utils/pdfLanguage");
const {
  escapeHtml,
  formatDate,
  formatMoney,
  getDocumentDirection,
  renderHtmlDocument,
} = require("./pdfTemplateUtils");
const { sendPdfResponse } = require("./pdfBrowser");

const renderInvoiceRows = (invoice, company, language) =>
  (invoice.items || [])
    .map((item, index) => {
      const productName = item.productName || item.productId?.name || "-";
      return `
        <tr>
          <td class="num">${index + 1}</td>
          <td class="product ${language === "ar" ? "rtl-cell" : ""}">${escapeHtml(productName)}</td>
          <td class="num">${escapeHtml(String(item.quantity || 0))}</td>
          <td class="num">${escapeHtml(formatMoney(company, item.rate))}</td>
          <td class="num">${escapeHtml(formatMoney(company, item.amount))}</td>
        </tr>
      `;
    })
    .join("");

const buildInvoiceHtml = ({ invoice, company, party, type, language }) => {
  const t = getPdfLabels(language);
  const dir = getDocumentDirection(language);
  const title = type === "SALE" ? t.invoiceTitleSale : t.invoiceTitlePurchase;
  const balance = Number(invoice.totalAmount || 0) - Number(invoice.paidAmount || 0);
  const rows = renderInvoiceRows(invoice, company, language);
  const partyLabel = type === "SALE" ? t.billTo : t.supplier;

  const body = `
    <section class="invoice-shell ${dir === "rtl" ? "rtl" : ""}">
      <header class="hero-card">
        <h1>${escapeHtml(company?.name || "Company")}</h1>
        <p>${escapeHtml(company?.address || "-")}</p>
        <p>${escapeHtml(`${t.gstin}: ${company?.gstNumber || company?.gstin || "-"}`)}</p>
      </header>

      <h2 class="page-title">${escapeHtml(title)}</h2>

      <section class="info-grid">
        <article class="info-card">
          <h3>${escapeHtml(partyLabel)}</h3>
          <p class="party-name">${escapeHtml(party?.name || "-")}</p>
          <p>${escapeHtml(`${t.address}: ${party?.address || "-"}`)}</p>
          <p>${escapeHtml(`${t.gstin}: ${party?.gstNumber || "-"}`)}</p>
        </article>

        <article class="info-card meta-card">
          <div class="meta-row">
            <span>${escapeHtml(t.invoiceNo)}</span>
            <strong>${escapeHtml(invoice.invoiceNo || "-")}</strong>
          </div>
          <div class="meta-row">
            <span>${escapeHtml(t.invoiceDate)}</span>
            <strong>${escapeHtml(formatDate(invoice.invoiceDate))}</strong>
          </div>
          <div class="meta-row">
            <span>${escapeHtml(t.paymentType)}</span>
            <strong>${escapeHtml(String(invoice.paymentType || "credit").toUpperCase())}</strong>
          </div>
          <div class="meta-row">
            <span>${escapeHtml(t.status)}</span>
            <strong>${escapeHtml(invoice.status || "-")}</strong>
          </div>
        </article>
      </section>

      <section class="table-card">
        <table>
          <thead>
            <tr>
              <th class="num">${escapeHtml(t.srNo)}</th>
              <th class="${dir === "rtl" ? "rtl-cell" : ""}">${escapeHtml(t.product)}</th>
              <th class="num">${escapeHtml(t.qty)}</th>
              <th class="num">${escapeHtml(t.rate)}</th>
              <th class="num">${escapeHtml(t.amount)}</th>
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="5" class="empty">-</td></tr>`}
          </tbody>
        </table>
      </section>

      <section class="summary-wrap">
        <article class="summary-card">
          <div class="summary-row"><span>${escapeHtml(t.subtotal)}</span><strong>${escapeHtml(formatMoney(company, invoice.subtotal))}</strong></div>
          <div class="summary-row"><span>${escapeHtml(t.tax)}</span><strong>${escapeHtml(formatMoney(company, invoice.tax))}</strong></div>
          <div class="summary-row"><span>${escapeHtml(t.total)}</span><strong>${escapeHtml(formatMoney(company, invoice.totalAmount))}</strong></div>
          <div class="summary-row"><span>${escapeHtml(t.paid)}</span><strong>${escapeHtml(formatMoney(company, invoice.paidAmount))}</strong></div>
          <div class="summary-row total-row"><span>${escapeHtml(t.balance)}</span><strong>${escapeHtml(formatMoney(company, balance))}</strong></div>
        </article>
      </section>

      <footer class="signature">${escapeHtml(t.authorisedSignatory)}</footer>
    </section>
  `;

  return renderHtmlDocument({
    title,
    language,
    body,
    extraCss: `
      .invoice-shell {
        width: 100%;
      }
      .hero-card {
        border: 1px solid var(--line);
        padding: 14px 16px;
        text-align: center;
      }
      .hero-card h1 {
        margin: 0 0 6px;
        font-size: 22px;
      }
      .hero-card p {
        margin: 2px 0;
        color: var(--muted);
      }
      .page-title {
        margin: 14px 0 16px;
        text-align: center;
        font-size: 18px;
        text-decoration: underline;
      }
      .info-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        margin-bottom: 16px;
      }
      .info-card {
        border: 1px solid var(--line);
        padding: 12px 14px;
      }
      .info-card h3 {
        margin: 0 0 10px;
        font-size: 13px;
      }
      .info-card p {
        margin: 4px 0;
        color: var(--muted);
      }
      .party-name {
        color: var(--text) !important;
        font-weight: 600;
      }
      .meta-card .meta-row {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin: 6px 0;
      }
      .meta-card .meta-row span {
        color: var(--muted);
      }
      .table-card {
        border: 1px solid var(--soft-line);
        overflow: hidden;
      }
      thead th {
        background: var(--soft-fill);
        border-bottom: 1px solid var(--line);
        padding: 9px 10px;
        font-size: 11px;
      }
      tbody td {
        border-top: 1px solid var(--soft-line);
        padding: 8px 10px;
        vertical-align: top;
      }
      .num {
        text-align: right;
        white-space: nowrap;
      }
      .rtl-cell {
        text-align: right;
      }
      .product {
        width: 46%;
      }
      .empty {
        text-align: center;
        color: var(--muted);
      }
      .summary-wrap {
        display: flex;
        justify-content: flex-end;
        margin-top: 16px;
      }
      .summary-card {
        width: 270px;
        border: 1px solid var(--line);
        padding: 10px 12px;
      }
      .summary-row {
        display: flex;
        justify-content: space-between;
        gap: 14px;
        margin: 6px 0;
      }
      .summary-row span {
        color: var(--muted);
      }
      .total-row {
        padding-top: 8px;
        border-top: 1px solid var(--soft-line);
      }
      .signature {
        margin-top: 28px;
        text-align: right;
        color: var(--muted);
      }
      .rtl .info-card,
      .rtl .meta-card,
      .rtl .summary-card,
      .rtl .signature {
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
  const language = options.language || "en";
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
