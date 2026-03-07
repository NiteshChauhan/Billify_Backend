const { getProfitSummary } = require("../utils/profitUtils");
const { getDateRangeFromQuery } = require("../utils/dateRange");

exports.getProfit = async (req, res) => {
  try {
    const { range, mode } = req.query;
    const companyId = req.user.companyId;

    const now = new Date();
    let fromDate;
    let toDate = now;

    /* ---------- CUSTOM DATE RANGE ---------- */
    const explicitRange = getDateRangeFromQuery(req.query);
    if (explicitRange) {
      fromDate = explicitRange.fromDate;
      toDate = explicitRange.toDate;
    } else {

    /* ---------- PREDEFINED RANGES ---------- */
      fromDate = new Date();

      switch (range) {
        case "today":
          fromDate.setHours(0, 0, 0, 0);
          break;

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
    }

    const result = await getProfitSummary(companyId, fromDate, toDate);

    if (mode === "daily") {
      return res.json({
        from: fromDate,
        to: toDate,
        daily: result.daily || [],
      });
    }

    res.json(result);
  } catch (err) {
    console.error("Profit API Error:", err);
    res.status(500).json({ error: "Failed to calculate profit" });
  }
};
