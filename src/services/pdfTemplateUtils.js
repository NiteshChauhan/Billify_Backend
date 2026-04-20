const fs = require("fs");
const path = require("path");

const FONT_DIR = path.join(__dirname, "..", "assets", "fonts");

const FONT_FILES = {
  notoSans: "NotoSans-Regular.ttf",
  notoArabic: "NotoNaskhArabic-Regular.ttf",
  notoDevanagari: "NotoSansDevanagari-Regular.ttf",
};

const MULTILINGUAL_TEST_STRINGS = {
  en: "Invoice",
  ar: "\u0641\u0627\u062a\u0648\u0631\u0629",
  hi: "\u091a\u093e\u0932\u093e\u0928",
};

const FONT_MIME = {
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const readFontDataUri = (fileName) => {
  const filePath = path.join(FONT_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required PDF font: ${fileName}`);
  }
  const ext = path.extname(fileName).toLowerCase();
  const mime = FONT_MIME[ext] || "font/ttf";
  const buffer = fs.readFileSync(filePath);
  return `data:${mime};base64,${buffer.toString("base64")}`;
};

const buildEmbeddedFontCss = () => {
  const notoSans = readFontDataUri(FONT_FILES.notoSans);
  const notoArabic = readFontDataUri(FONT_FILES.notoArabic);
  const notoDevanagari = readFontDataUri(FONT_FILES.notoDevanagari);

  return `
    @font-face {
      font-family: 'Noto Sans Local';
      src: url('${notoSans}') format('truetype');
      font-weight: 400;
      font-style: normal;
      font-display: block;
    }
    @font-face {
      font-family: 'Noto Naskh Arabic Local';
      src: url('${notoArabic}') format('truetype');
      font-weight: 400;
      font-style: normal;
      font-display: block;
    }
    @font-face {
      font-family: 'Noto Sans Devanagari Local';
      src: url('${notoDevanagari}') format('truetype');
      font-weight: 400;
      font-style: normal;
      font-display: block;
    }
  `;
};

const getDocumentDirection = (language) => (language === "ar" ? "rtl" : "ltr");

const getDocumentFontStack = (language) => {
  if (language === "ar") {
    return "'Noto Naskh Arabic Local', 'Noto Sans Local', sans-serif";
  }
  if (language === "hi") {
    return "'Noto Sans Devanagari Local', 'Noto Sans Local', sans-serif";
  }
  return "'Noto Sans Local', sans-serif";
};

const renderSmokeTestMarkup = () => `
  <div class="pdf-smoke-test" aria-hidden="true">
    <span lang="en">${escapeHtml(MULTILINGUAL_TEST_STRINGS.en)}</span>
    <span lang="ar" dir="rtl">${escapeHtml(MULTILINGUAL_TEST_STRINGS.ar)}</span>
    <span lang="hi">${escapeHtml(MULTILINGUAL_TEST_STRINGS.hi)}</span>
  </div>
`;

const renderHtmlDocument = ({ title, language, body, extraCss = "" }) => {
  const dir = getDocumentDirection(language);
  const fontStack = getDocumentFontStack(language);

  return `<!DOCTYPE html>
<html lang="${escapeHtml(language)}" dir="${dir}">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      ${buildEmbeddedFontCss()}
      :root {
        --text: #111827;
        --muted: #475569;
        --line: #cbd5e1;
        --soft-line: #e5e7eb;
        --soft-fill: #eff6ff;
        --page-width: 100%;
      }
      * {
        box-sizing: border-box;
      }
      html, body {
        margin: 0;
        padding: 0;
        color: var(--text);
        background: #ffffff;
        font-family: ${fontStack};
        -webkit-font-smoothing: antialiased;
        text-rendering: geometricPrecision;
      }
      body {
        font-size: 12px;
        line-height: 1.45;
        direction: ${dir};
        unicode-bidi: plaintext;
        padding: 16mm 12mm;
      }
      table {
        border-collapse: collapse;
        width: 100%;
      }
      [lang="ar"], .lang-ar {
        font-family: 'Noto Naskh Arabic Local', 'Noto Sans Local', sans-serif;
        direction: rtl;
        text-align: right;
      }
      [lang="hi"], .lang-hi {
        font-family: 'Noto Sans Devanagari Local', 'Noto Sans Local', sans-serif;
      }
      .pdf-smoke-test {
        position: fixed;
        left: -10000px;
        top: -10000px;
        opacity: 0;
        pointer-events: none;
        font-size: 10px;
        white-space: nowrap;
      }
      ${extraCss}
    </style>
  </head>
  <body>
    ${renderSmokeTestMarkup()}
    ${body}
  </body>
</html>`;
};

const formatMoney = (company, amount) => {
  const symbol = company?.currencySymbol || "Rs";
  const decimals = Number(company?.currencyDecimals ?? 2);
  return `${symbol} ${Number(amount || 0).toFixed(decimals)}`;
};

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "-";

module.exports = {
  FONT_DIR,
  FONT_FILES,
  MULTILINGUAL_TEST_STRINGS,
  escapeHtml,
  formatMoney,
  formatDate,
  getDocumentDirection,
  renderHtmlDocument,
};
