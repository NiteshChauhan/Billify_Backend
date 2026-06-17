const SalesInvoice = require("../models/SalesInvoice");
const Company = require("../models/Company");
const Branch = require("../models/Branch");
const { withBranchScope } = require("../utils/branchScope");
const { escapeHtml, formatDate, renderHtmlDocument } = require("../services/pdfTemplateUtils");
const { sendPdfResponse } = require("../services/pdfBrowser");

const buildInvoiceQuery = (req) => {
  const query = withBranchScope(
    { companyId: req.user.companyId },
    req.query.branchId || req.user.branchId,
    req.user.branchIsDefault,
  );
  if (req.query.fromDate || req.query.from) {
    query.invoiceDate = { ...(query.invoiceDate || {}), $gte: new Date(req.query.fromDate || req.query.from) };
  }
  if (req.query.toDate || req.query.to) {
    const to = new Date(req.query.toDate || req.query.to);
    to.setHours(23, 59, 59, 999);
    query.invoiceDate = { ...(query.invoiceDate || {}), $lte: to };
  }
  if (req.query.partyId) query.partyId = req.query.partyId;
  if (req.query.siteId) query.siteId = req.query.siteId;
  if (req.query.applicatorId) query.applicatorId = req.query.applicatorId;
  return query;
};

const loadInvoices = (req) =>
  SalesInvoice.find(buildInvoiceQuery(req))
    .populate("partyId", "name")
    .populate("siteId", "name")
    .populate("items.productId", "name unitName attributes")
    .sort({ invoiceDate: -1, createdAt: -1 })
    .lean();

const unitForItem = (item) =>
  item.productId?.unitName ||
  item.unitName ||
  item.packing ||
  item.productId?.attributes?.unit ||
  item.productId?.attributes?.Unit ||
  "";

const itemName = (item) => item.productName || item.productId?.name || "-";
const siteName = (invoice) => invoice.siteId?.name || invoice.customerBranch || "-";
const applicatorName = (invoice) => invoice.applicatorName || "Unassigned";

exports.itemDistribution = async (req, res) => {
  try {
    const invoices = await loadInvoices(req);
    const map = new Map();
    invoices.forEach((invoice) => {
      (invoice.items || []).forEach((item) => {
        if (req.query.itemId && String(item.productId?._id || item.productId) !== String(req.query.itemId)) return;
        const key = [
          item.productId?._id || item.productId || itemName(item),
          invoice.partyId?._id || "",
          invoice.siteId?._id || siteName(invoice),
          invoice.applicatorId || "unassigned",
        ].join(":");
        const row = map.get(key) || {
          item: itemName(item),
          party: invoice.partyId?.name || "-",
          site: siteName(invoice),
          applicator: applicatorName(invoice),
          deliveries: 0,
          totalQty: 0,
          unit: unitForItem(item),
          totalValue: 0,
        };
        row.deliveries += 1;
        row.totalQty += Number(item.quantity || 0);
        row.totalValue += Number(item.amount || Number(item.quantity || 0) * Number(item.rate || 0));
        map.set(key, row);
      });
    });
    res.json([...map.values()]);
  } catch (err) {
    res.status(500).json({ message: "Failed to load item distribution report" });
  }
};

exports.applicatorSummary = async (req, res) => {
  try {
    const invoices = await loadInvoices(req);
    const map = new Map();
    invoices.forEach((invoice) => {
      const key = String(invoice.applicatorId || "unassigned");
      const row = map.get(key) || {
        applicatorId: invoice.applicatorId || null,
        applicatorName: applicatorName(invoice),
        totalQty: 0,
        totalValue: 0,
        invoiceIds: new Set(),
      };
      (invoice.items || []).forEach((item) => {
        row.totalQty += Number(item.quantity || 0);
      });
      row.totalValue += Number(invoice.totalAmount || 0);
      row.invoiceIds.add(String(invoice._id));
      map.set(key, row);
    });
    res.json(
      [...map.values()].map((row) => ({
        applicatorId: row.applicatorId,
        applicatorName: row.applicatorName,
        totalQty: row.totalQty,
        totalValue: row.totalValue,
        invoiceCount: row.invoiceIds.size,
      })),
    );
  } catch (err) {
    res.status(500).json({ message: "Failed to load applicator summary" });
  }
};

exports.itemSummary = async (req, res) => {
  try {
    const invoices = await loadInvoices(req);
    const map = new Map();
    invoices.forEach((invoice) => {
      (invoice.items || []).forEach((item) => {
        const key = String(item.productId?._id || item.productId || itemName(item));
        const row = map.get(key) || {
          item: itemName(item),
          totalQty: 0,
          unit: unitForItem(item),
          totalValue: 0,
        };
        row.totalQty += Number(item.quantity || 0);
        row.totalValue += Number(item.amount || Number(item.quantity || 0) * Number(item.rate || 0));
        map.set(key, row);
      });
    });
    res.json([...map.values()]);
  } catch (err) {
    res.status(500).json({ message: "Failed to load item summary" });
  }
};

exports.applicatorSummaryPdf = async (req, res) => {
  try {
    const [company, branch, invoices] = await Promise.all([
      Company.findById(req.user.companyId).lean(),
      req.query.branchId || req.user.branchId ? Branch.findById(req.query.branchId || req.user.branchId).lean() : null,
      loadInvoices(req),
    ]);
    const rows = [];
    invoices.forEach((invoice) => {
      (invoice.items || []).forEach((item) => {
        rows.push({
          applicator: applicatorName(invoice),
          party: invoice.partyId?.name || "-",
          site: siteName(invoice),
          item: itemName(item),
          qty: Number(item.quantity || 0),
          unit: unitForItem(item),
          value: Number(item.amount || Number(item.quantity || 0) * Number(item.rate || 0)),
        });
      });
    });

    const html = renderHtmlDocument({
      title: "Applicator Summary",
      body: `
        <h1>${escapeHtml(company?.name || "Company")}</h1>
        <p>Branch: ${escapeHtml(branch?.branchName || "All")} | Date: ${escapeHtml(req.query.fromDate || req.query.from || "-")} to ${escapeHtml(req.query.toDate || req.query.to || "-")}</p>
        <table>
          <thead><tr><th>Applicator</th><th>Party</th><th>Site</th><th>Item</th><th>Qty</th><th>Unit</th><th>Value</th></tr></thead>
          <tbody>
            ${
              rows.map((row) => `
                <tr>
                  <td>${escapeHtml(row.applicator)}</td><td>${escapeHtml(row.party)}</td><td>${escapeHtml(row.site)}</td>
                  <td>${escapeHtml(row.item)}</td><td>${row.qty}</td><td>${escapeHtml(row.unit)}</td><td>${row.value.toFixed(2)}</td>
                </tr>`).join("") || "<tr><td colspan='7'>No records</td></tr>"
            }
          </tbody>
        </table>
      `,
      extraCss: "table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:6px;text-align:left}h1{font-size:20px}",
    });
    await sendPdfResponse(res, { html, filename: "applicator-summary.pdf" });
  } catch (err) {
    res.status(500).json({ message: "Failed to export applicator summary PDF" });
  }
};

exports.exportInvoicesCsv = async (req, res) => {
  try {
    const invoices = await loadInvoices(req);
    const lines = [[
      "Invoice No",
      "Invoice Date",
      "Party",
      "Site",
      "Applicator",
      "Item",
      "Unit",
      "Qty",
      "Rate",
      "Amount",
      "Payment Status",
      "Created By",
      "Branch",
    ]];
    invoices.forEach((invoice) => {
      (invoice.items || []).forEach((item) => {
        lines.push([
          invoice.invoiceNo || "",
          formatDate(invoice.invoiceDate),
          invoice.partyId?.name || "",
          siteName(invoice),
          applicatorName(invoice),
          itemName(item),
          unitForItem(item),
          Number(item.quantity || 0),
          Number(item.rate || 0),
          Number(item.amount || Number(item.quantity || 0) * Number(item.rate || 0)),
          invoice.status || "",
          invoice.salesman || "",
          "",
        ]);
      });
    });
    const csv = lines
      .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="invoices.csv"');
    res.send(`${csv}\n`);
  } catch (err) {
    res.status(500).json({ message: "Failed to export invoices CSV" });
  }
};

exports.exportInvoicesPdf = async (req, res) => {
  try {
    const [company, invoices] = await Promise.all([Company.findById(req.user.companyId).lean(), loadInvoices(req)]);
    const html = renderHtmlDocument({
      title: "Invoices Export",
      body: `
        <h1>${escapeHtml(company?.name || "Company")} - Invoices</h1>
        <table>
          <thead><tr><th>Invoice No</th><th>Date</th><th>Party</th><th>Site</th><th>Applicator</th><th>Total Qty</th><th>Total Amount</th><th>Status</th><th>Branch</th></tr></thead>
          <tbody>
            ${
              invoices.map((invoice) => `
                <tr>
                  <td>${escapeHtml(invoice.invoiceNo || "")}</td><td>${escapeHtml(formatDate(invoice.invoiceDate))}</td>
                  <td>${escapeHtml(invoice.partyId?.name || "")}</td><td>${escapeHtml(siteName(invoice))}</td>
                  <td>${escapeHtml(applicatorName(invoice))}</td><td>${(invoice.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0)}</td>
                  <td>${Number(invoice.totalAmount || 0).toFixed(2)}</td><td>${escapeHtml(invoice.status || "")}</td><td></td>
                </tr>`).join("") || "<tr><td colspan='9'>No records</td></tr>"
            }
          </tbody>
        </table>
      `,
      extraCss: "table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #ddd;padding:5px;text-align:left}h1{font-size:18px}",
    });
    await sendPdfResponse(res, { html, filename: "invoices.pdf" });
  } catch (err) {
    res.status(500).json({ message: "Failed to export invoices PDF" });
  }
};
