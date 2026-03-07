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

exports.getDateRangeFromQuery = (query = {}) => {
  const { from, to, fyStart, fyEnd } = query;

  if (from && to && isValidDate(from) && isValidDate(to)) {
    return {
      fromDate: startOfDay(from),
      toDate: endOfDay(to),
    };
  }

  if (fyStart && fyEnd && isValidDate(fyStart) && isValidDate(fyEnd)) {
    return {
      fromDate: startOfDay(fyStart),
      toDate: endOfDay(fyEnd),
    };
  }

  return null;
};

