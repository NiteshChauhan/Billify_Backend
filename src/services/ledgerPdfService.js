const { getPdfLabels } = require("../utils/pdfLanguage");
const {
  escapeHtml,
  formatDate,
  getDocumentDirection,
  renderHtmlDocument,
} = require("./pdfTemplateUtils");
const { sendPdfResponse } = require("./pdfBrowser");

const formatLedgerAmount = (value) => Number(value || 0).toFixed(2);

const buildLedgerRows = (ledger, language) =>
  ledger
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(formatDate(row.date))}</td>
          <td class="${language === "ar" ? "rtl-cell" : ""}">${escapeHtml(row.particulars || "-")}</td>
          <td class="num">${escapeHtml(formatLedgerAmount(row.debit))}</td>
          <td class="num">${escapeHtml(formatLedgerAmount(row.credit))}</td>
          <td class="num">${escapeHtml(formatLedgerAmount(row.balance))}</td>
        </tr>
      `,
    )
    .join("");

const buildLedgerHtml = ({ party, ledger, balance, filterType, language }) => {
  const t = getPdfLabels(language);
  const dir = getDocumentDirection(language);
  const titleSuffix =
    filterType && filterType !== "all" ? ` (${String(filterType).toUpperCase()})` : "";
  const body = `
    <section class="ledger-shell ${dir === "rtl" ? "rtl" : ""}">
      <header class="ledger-header">
        <h1>${escapeHtml(`${t.ledgerTitle}${titleSuffix}`)}</h1>
        <div class="ledger-meta">
          <div><span>${escapeHtml(t.party)}</span><strong>${escapeHtml(party.name || "-")}</strong></div>
          <div><span>${escapeHtml(t.openingBalance)}</span><strong>${escapeHtml(`${party.openingBalance || 0} (${party.openingType || "receivable"})`)}</strong></div>
          <div><span>${escapeHtml(t.closingBalance)}</span><strong>${escapeHtml(formatLedgerAmount(balance))}</strong></div>
        </div>
      </header>

      <section class="ledger-table-card">
        <table>
          <thead>
            <tr>
              <th>${escapeHtml(t.date)}</th>
              <th class="${dir === "rtl" ? "rtl-cell" : ""}">${escapeHtml(t.particulars)}</th>
              <th class="num">${escapeHtml(t.debit)}</th>
              <th class="num">${escapeHtml(t.credit)}</th>
              <th class="num">${escapeHtml(t.closingBalance)}</th>
            </tr>
          </thead>
          <tbody>
            ${buildLedgerRows(ledger, language) || `<tr><td colspan="5" class="empty">-</td></tr>`}
          </tbody>
        </table>
      </section>
    </section>
  `;

  return renderHtmlDocument({
    title: `${t.ledgerTitle}${titleSuffix}`,
    language,
    body,
    extraCss: `
      .ledger-header {
        border-bottom: 2px solid var(--line);
        padding-bottom: 12px;
        margin-bottom: 16px;
      }
      .ledger-header h1 {
        margin: 0 0 12px;
        text-align: center;
        font-size: 20px;
      }
      .ledger-meta {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 12px;
      }
      .ledger-meta div {
        border: 1px solid var(--line);
        padding: 10px 12px;
      }
      .ledger-meta span {
        display: block;
        color: var(--muted);
        margin-bottom: 4px;
      }
      .ledger-table-card {
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
      .empty {
        text-align: center;
        color: var(--muted);
      }
      .rtl .ledger-meta div,
      .rtl .ledger-header {
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

const generateLedgerPdf = async (res, { party, ledger, balance, filterType, language }) => {
  const html = buildLedgerHtml({
    party,
    ledger,
    balance,
    filterType,
    language,
  });
  const fileSlug = String(party.name || "ledger").replace(/[^\w.-]+/g, "-").toLowerCase();
  await sendPdfResponse(res, {
    html,
    filename: `ledger-${fileSlug}.pdf`,
  });
};

module.exports = {
  buildLedgerHtml,
  generateLedgerPdf,
};
