const { getProfitSummary } = require("../utils/profitUtils");

const endOfDay = (date) => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const isValidDate = (value) => !Number.isNaN(new Date(value).getTime());

exports.getProfit = async (req, res) => {
  try {
    const { range, mode, from, to, fyStart, fyEnd } = req.query;
    const companyId = req.user.companyId;

    const now = new Date();
    let fromDate;
    let toDate = now;

    /* ---------- DATE RANGE PRECEDENCE ---------- */
    if (from && to && isValidDate(from) && isValidDate(to)) {
      fromDate = startOfDay(from);
      toDate = endOfDay(to);
    } else if (range === "today") {
      fromDate = startOfDay(now);
      toDate = endOfDay(now);
    } else if (range) {
      /* ---------- PREDEFINED RANGES ---------- */
      fromDate = new Date();

      switch (range) {
        case "week":
          fromDate.setDate(now.getDate() - 7);
          break;

        case "last_week":
          fromDate.setDate(now.getDate() - 14);
          toDate = new Date();
          toDate.setDate(now.getDate() - 7);
          break;

        case "month":
          fromDate.setMonth(now.getMonth() - 1);
          break;

        case "year":
          fromDate.setFullYear(now.getFullYear() - 1);
          break;

        default:
          fromDate.setHours(0, 0, 0, 0);
      }
    } else if (fyStart && fyEnd && isValidDate(fyStart) && isValidDate(fyEnd)) {
      fromDate = startOfDay(fyStart);
      toDate = endOfDay(fyEnd);
    } else {
      fromDate = startOfDay(now);
      toDate = endOfDay(now);
    }

    const includeEntries = mode === "entries";
    const result = await getProfitSummary(companyId, fromDate, toDate, req.user.branchId || null, {
      includeEntries,
      branchIsDefault: req.user.branchIsDefault,
    });

    if (mode === "daily") {
      return res.json({
        from: fromDate,
        to: toDate,
        daily: result.daily || [],
      });
    }

    if (mode === "entries") {
      return res.json({
        from: fromDate,
        to: toDate,
        entries: result.entries || [],
        sales: result.sales || 0,
        cost: result.cost || 0,
        profit: result.profit || 0,
      });
    }

    res.json(result);
  } catch (err) {
    console.error("Profit API Error:", err);
    res.status(500).json({ error: "Failed to calculate profit" });
  }
};
