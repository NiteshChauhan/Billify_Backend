const ReturnEntry = require("../models/Return");
const SalesInvoice = require("../models/SalesInvoice");
const PurchaseInvoice = require("../models/PurchaseInvoice");
const StockLedger = require("../models/StockLedger");
const Party = require("../models/Party");
const { getAvailableStock } = require("../utils/stockUtils");
const { getDateRangeFromQuery } = require("../utils/dateRange");

const normalizeReturnType = (value = "") => {
  const type = String(value).toUpperCase();
  return type === "PURCHASE_RETURN" ? "PURCHASE_RETURN" : "SALE_RETURN";
};

const getBillModelByReturnType = (returnType) =>
  returnType === "PURCHASE_RETURN" ? PurchaseInvoice : SalesInvoice;

const validateItems = (items = []) => {
  if (!Array.isArray(items) || !items.length) {
    throw new Error("Return items are required");
  }
  items.forEach((item) => {
    if (!item.productId || !item.quantity || Number(item.quantity) <= 0) {
      throw new Error("Invalid return item data");
    }
    item.rate = Number(item.rate || 0);
    item.quantity = Number(item.quantity);
    item.amount = Number((item.quantity * item.rate).toFixed(2));
  });
};

exports.createSaleReturn = async (req, res) => {
  try {
    const { billId, items, remarks, returnDate } = req.body;
    const companyId = req.user.companyId;

    const invoice = await SalesInvoice.findOne({ _id: billId, companyId });
    if (!invoice) {
      return res.status(404).json({ message: "Sales bill not found" });
    }

    validateItems(items);

    const previousReturns = await ReturnEntry.find({
      companyId,
      billType: "SALE",
      billId,
    });
    const returnedMap = {};
    previousReturns.forEach((entry) => {
      entry.items.forEach((item) => {
        const key = String(item.productId);
        returnedMap[key] = (returnedMap[key] || 0) + Number(item.quantity || 0);
      });
    });

    for (const item of items) {
      const soldItem = invoice.items.find(
        (invItem) => String(invItem.productId) === String(item.productId),
      );
      if (!soldItem) {
        return res.status(400).json({ message: "Item not found in selected bill" });
      }
      const alreadyReturned = returnedMap[String(item.productId)] || 0;
      const maxAllowed = Number(soldItem.quantity || 0) - alreadyReturned;
      if (item.quantity > maxAllowed) {
        return res.status(400).json({
          message: `Return qty exceeds sold qty for product ${item.productId}`,
        });
      }
      if (!item.rate) {
        item.rate = Number(soldItem.rate || 0);
        item.amount = Number((item.quantity * item.rate).toFixed(2));
      }
    }

    for (const item of items) {
      await StockLedger.create({
        companyId,
        productId: item.productId,
        type: "SALE_RETURN",
        quantity: item.quantity,
        rate: item.rate,
        referenceType: "SALE_RETURN",
        referenceId: invoice._id,
      });
    }

    const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);
    const saleReturnCount = await ReturnEntry.countDocuments({
      companyId,
      returnType: "SALE_RETURN",
    });
    const returnNo = `SR-${saleReturnCount + 1}`;

    const returnEntry = await ReturnEntry.create({
      companyId,
      partyId: invoice.partyId,
      returnType: "SALE_RETURN",
      billType: "SALE",
      billId: invoice._id,
      originalSaleId: invoice._id,
      returnNo,
      returnDate,
      items,
      totalAmount,
      remarks,
    });

    const party = await Party.findById(invoice.partyId);
    if (party) {
      party.balance = Math.max(0, Number(party.balance || 0) - totalAmount);
      await party.save();
    }

    res.json(returnEntry);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.createPurchaseReturn = async (req, res) => {
  try {
    const { billId, items, remarks, returnDate, returnNo } = req.body;
    const companyId = req.user.companyId;
    const normalizedReturnNo = String(returnNo || "").trim();

    if (!normalizedReturnNo) {
      return res.status(400).json({ message: "Purchase return number is required" });
    }

    const duplicateReturnNo = await ReturnEntry.findOne({
      companyId,
      returnType: "PURCHASE_RETURN",
      returnNo: normalizedReturnNo,
    }).select("_id");

    if (duplicateReturnNo) {
      return res.status(400).json({ message: "Purchase return number already exists" });
    }

    const invoice = await PurchaseInvoice.findOne({ _id: billId, companyId });
    if (!invoice) {
      return res.status(404).json({ message: "Purchase bill not found" });
    }

    validateItems(items);

    const previousReturns = await ReturnEntry.find({
      companyId,
      billType: "PURCHASE",
      billId,
    });
    const returnedMap = {};
    previousReturns.forEach((entry) => {
      entry.items.forEach((item) => {
        const key = String(item.productId);
        returnedMap[key] = (returnedMap[key] || 0) + Number(item.quantity || 0);
      });
    });

    for (const item of items) {
      const purchasedItem = invoice.items.find(
        (invItem) => String(invItem.productId) === String(item.productId),
      );
      if (!purchasedItem) {
        return res.status(400).json({ message: "Item not found in selected bill" });
      }
      const alreadyReturned = returnedMap[String(item.productId)] || 0;
      const maxAllowed = Number(purchasedItem.quantity || 0) - alreadyReturned;
      if (item.quantity > maxAllowed) {
        return res.status(400).json({
          message: `Return qty exceeds purchased qty for product ${item.productId}`,
        });
      }
      if (!item.rate) {
        item.rate = Number(purchasedItem.rate || 0);
        item.amount = Number((item.quantity * item.rate).toFixed(2));
      }

      const availableStock = await getAvailableStock(companyId, item.productId);
      if (availableStock < item.quantity) {
        return res.status(400).json({
          message: `Insufficient stock for purchase return. Available: ${availableStock}`,
        });
      }
    }

    for (const item of items) {
      await StockLedger.create({
        companyId,
        productId: item.productId,
        type: "PURCHASE_RETURN",
        quantity: item.quantity,
        rate: item.rate,
        referenceType: "PURCHASE_RETURN",
        referenceId: invoice._id,
      });
    }

    const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);

    const returnEntry = await ReturnEntry.create({
      companyId,
      partyId: invoice.partyId,
      returnType: "PURCHASE_RETURN",
      billType: "PURCHASE",
      billId: invoice._id,
      originalPurchaseId: invoice._id,
      returnNo: normalizedReturnNo,
      returnDate,
      items,
      totalAmount,
      remarks,
    });

    const party = await Party.findById(invoice.partyId);
    if (party) {
      party.balance = Math.max(0, Number(party.balance || 0) - totalAmount);
      await party.save();
    }

    res.json(returnEntry);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.getReturnBills = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const returnType = normalizeReturnType(req.query.returnType || req.query.type);
    const BillModel = getBillModelByReturnType(returnType);
    const query = { companyId };

    const dateRange = getDateRangeFromQuery(req.query);
    if (dateRange) {
      query.invoiceDate = { $gte: dateRange.fromDate, $lte: dateRange.toDate };
    }

    if (req.query.partyId) {
      query.partyId = req.query.partyId;
    }

    const bills = await BillModel.find(query)
      .populate("partyId", "name")
      .sort({ invoiceDate: -1, createdAt: -1 })
      .select("_id invoiceNo invoiceDate totalAmount paidAmount status partyId items");

    res.json(
      bills.map((bill) => ({
        _id: bill._id,
        invoiceNo: bill.invoiceNo,
        invoiceDate: bill.invoiceDate,
        totalAmount: bill.totalAmount,
        paidAmount: bill.paidAmount,
        status: bill.status,
        partyId: bill.partyId,
        itemCount: Array.isArray(bill.items) ? bill.items.length : 0,
      })),
    );
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getReturnBillItems = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const returnType = normalizeReturnType(req.query.returnType || req.query.type);
    const BillModel = getBillModelByReturnType(returnType);
    const billType = returnType === "PURCHASE_RETURN" ? "PURCHASE" : "SALE";
    const billId = req.params.billId;

    const bill = await BillModel.findOne({ _id: billId, companyId })
      .populate("partyId", "name")
      .populate("items.productId", "name");

    if (!bill) {
      return res.status(404).json({ message: "Bill not found" });
    }

    const previousReturns = await ReturnEntry.find({
      companyId,
      billType,
      billId,
    }).select("items.productId items.quantity");

    const returnedMap = {};
    previousReturns.forEach((entry) => {
      entry.items.forEach((item) => {
        const key = String(item.productId);
        returnedMap[key] = (returnedMap[key] || 0) + Number(item.quantity || 0);
      });
    });

    const items = (bill.items || []).map((item) => {
      const productId = item.productId?._id || item.productId;
      const originalQty = Number(item.quantity || 0);
      const returnedQty = Number(returnedMap[String(productId)] || 0);
      const remainingQty = Math.max(0, originalQty - returnedQty);
      return {
        productId,
        productName: item.productId?.name || "Unknown Product",
        rate: Number(item.rate || 0),
        originalQty,
        returnedQty,
        remainingQty,
      };
    });

    res.json({
      bill: {
        _id: bill._id,
        invoiceNo: bill.invoiceNo,
        invoiceDate: bill.invoiceDate,
        totalAmount: bill.totalAmount,
        paidAmount: bill.paidAmount,
        status: bill.status,
        partyId: bill.partyId,
      },
      items,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getReturns = async (req, res) => {
  const query = { companyId: req.user.companyId };
  if (req.query.billId) query.billId = req.query.billId;
  if (req.query.billType) query.billType = req.query.billType;
  const range = getDateRangeFromQuery(req.query);
  if (range) {
    query.returnDate = { $gte: range.fromDate, $lte: range.toDate };
  }

  const data = await ReturnEntry.find(query)
    .populate("partyId", "name")
    .populate("items.productId", "name")
    .sort({ returnDate: -1, createdAt: -1 });

  res.json(data);
};
