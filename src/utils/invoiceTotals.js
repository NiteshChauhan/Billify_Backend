const normalizeOtherCharges = (charges = []) =>
  (Array.isArray(charges) ? charges : [])
    .map((charge) => ({
      name: String(charge?.name || "").trim(),
      amount: Number(charge?.amount || 0),
    }))
    .filter((charge) => charge.name && Number.isFinite(charge.amount) && charge.amount > 0);

const calculateInvoiceTotals = (items = [], options = {}) => {
  const gstEnabled = options.gstEnabled !== false;
  const requestedTax = Number(options.tax || 0);
  const otherCharges = normalizeOtherCharges(options.otherCharges);
  const otherChargesTotal = otherCharges.reduce((sum, charge) => sum + charge.amount, 0);
  let subtotal = 0;

  (items || []).forEach((item) => {
    item.amount = Number(item.quantity || 0) * Number(item.rate || 0);
    subtotal += item.amount;
  });

  const tax = gstEnabled ? requestedTax : 0;
  const totalAmount = subtotal + tax + otherChargesTotal;

  return {
    subtotal,
    tax,
    otherCharges,
    otherChargesTotal,
    totalAmount,
  };
};

module.exports = {
  calculateInvoiceTotals,
  normalizeOtherCharges,
};
