const Payment = require("../models/Payment");
const Party = require("../models/Party");
const SalesInvoice = require("../models/SalesInvoice");

exports.createReceipt = async (req, res) => {
  try {
    const { partyId: bodyPartyId, invoiceId, amount, paymentMode, referenceNo, remarks } =
      req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid receipt amount" });
    }

    const invoice = await SalesInvoice.findOne({
      _id: invoiceId,
      companyId: req.user.companyId,
    });

    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const partyId = bodyPartyId || invoice.partyId?.toString();
    if (!partyId) {
      return res.status(400).json({ error: "partyId is required" });
    }

    const payments = await Payment.find({
      companyId: req.user.companyId,
      invoiceType: "SALE",
      invoiceId,
    });

    const alreadyPaid = payments.reduce((t, p) => t + p.amount, 0);

    if (alreadyPaid + amount > invoice.totalAmount) {
      return res.status(400).json({
        error: `Receipt exceeds balance. Remaining ₹${
          invoice.totalAmount - alreadyPaid
        }`,
      });
    }

    const receipt = await Payment.create({
      companyId: req.user.companyId,
      partyId,
      invoiceType: "SALE",
      invoiceId,
      amount,
      paymentMode,
      referenceNo,
      remarks,
    });

    /* 🔄 UPDATE INVOICE */
    const newPaid = alreadyPaid + amount;
    invoice.paidAmount = newPaid;
    invoice.status =
      newPaid === invoice.totalAmount
        ? "PAID"
        : newPaid > 0
          ? "PARTIAL"
          : "DUE";

    await invoice.save();

    /* 🔄 UPDATE PARTY BALANCE */
    const party = await Party.findById(partyId);
    party.balance -= amount; // receivable reduced
    await party.save();

    res.json(receipt);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
