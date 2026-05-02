const calculateInvoiceTotals = (items = [], options = {}) => {
  const gstEnabled = options.gstEnabled !== false;
  const requestedTax = Number(options.tax || 0);
  let subtotal = 0;

  (items || []).forEach((item) => {
    item.amount = Number(item.quantity || 0) * Number(item.rate || 0);
    subtotal += item.amount;
  });

  const tax = gstEnabled ? requestedTax : 0;
  const totalAmount = subtotal + tax;

  return {
    subtotal,
    tax,
    totalAmount,
  };
};

module.exports = {
  calculateInvoiceTotals,
};
