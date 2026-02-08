import PurchaseInvoice from "@/models/PurchaseInvoice";
import StockLedger from "@/models/StockLedger";
import Supplier from "@/models/Supplier";
import Payment from "@/models/Payment";

/* ================= CREATE PURCHASE INVOICE ================= */
export const createPurchaseInvoice = async (req, res) => {
  try {
    const {
      supplierId,
      items,
      tax = 0,
      paidAmount = 0,
      invoiceDate,
    } = req.body;

    if (!supplierId || !items || items.length === 0) {
      return res.status(400).json({
        message: "Supplier and items are required",
      });
    }

    let subtotal = 0;

    for (const item of items) {
      if (!item.productId || !item.quantity || !item.rate) {
        return res.status(400).json({
          message: "Invalid item data",
        });
      }

      item.amount = item.quantity * item.rate;
      subtotal += item.amount;
    }

    const totalAmount = subtotal + tax;

    if (paidAmount > totalAmount) {
      return res.status(400).json({
        message: "Paid amount cannot exceed invoice total",
      });
    }

    /* 🔢 AUTO INVOICE NUMBER */
    const count = await PurchaseInvoice.countDocuments({
      companyId: req.user.companyId,
    });

    const invoiceNo = `PUR-${count + 1}`;

    /* ✅ CREATE INVOICE */
    const invoice = await PurchaseInvoice.create({
      companyId: req.user.companyId,
      supplierId,
      invoiceNo,
      invoiceDate,
      items,
      subtotal,
      tax,
      totalAmount,
      paidAmount: 0,
      status: "DUE",
    });

    /* 📦 STOCK LEDGER */
    for (const item of items) {
      await StockLedger.create({
        companyId: req.user.companyId,
        productId: item.productId,
        type: "PURCHASE",
        quantity: item.quantity,
        rate: item.rate,
        referenceType: "PURCHASE_INVOICE",
        referenceId: invoice._id,
      });
    }

    /* 💰 INITIAL PAYMENT */
    let finalPaidAmount = 0;

    if (paidAmount > 0) {
      await Payment.create({
        companyId: req.user.companyId,
        partyType: "SUPPLIER",
        partyId: supplierId,
        invoiceType: "PURCHASE",
        invoiceId: invoice._id,
        amount: paidAmount,
        paymentMode: "CASH",
        remarks: "Payment at invoice creation",
      });

      finalPaidAmount = paidAmount;
    }

    /* 🔄 UPDATE INVOICE STATUS */
    invoice.paidAmount = finalPaidAmount;
    invoice.status =
      finalPaidAmount === totalAmount
        ? "PAID"
        : finalPaidAmount > 0
          ? "PARTIAL"
          : "DUE";

    await invoice.save();

    /* 🧾 UPDATE SUPPLIER BALANCE */
    const supplier = await Supplier.findById(supplierId);
    supplier.balance = supplier.balance || 0;
    supplier.balance += totalAmount - finalPaidAmount;
    await supplier.save();

    res.status(201).json(invoice);
  } catch (err) {
    console.error("Create Purchase Error:", err);
    res.status(500).json({
      message: "Failed to create purchase invoice",
      error: err.message,
    });
  }
};

/* ================= GET ALL PURCHASES ================= */
export const getPurchases = async (req, res) => {
  try {
    const data = await PurchaseInvoice.find({
      companyId: req.user.companyId,
    })
      .populate("supplierId", "name")
      .sort({ createdAt: -1 });

    res.json(data);
  } catch (err) {
    res.status(500).json({
      message: "Failed to fetch purchases",
    });
  }
};

/* ================= GET PURCHASE BY ID ================= */
export const getPurchaseById = async (req, res) => {
  try {
    const invoice = await PurchaseInvoice.findById(req.query.id)
      .populate("supplierId", "name")
      .populate("items.productId", "name");

    if (!invoice) {
      return res.status(404).json({
        message: "Purchase invoice not found",
      });
    }

    res.json(invoice);
  } catch (err) {
    res.status(500).json({
      message: "Failed to fetch purchase invoice",
    });
  }
};
