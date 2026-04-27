const Branch = require("../models/Branch");
const CollectionTransfer = require("../models/CollectionTransfer");

const normalizeDate = (value) => {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? null : date;
};

exports.listTransfers = async (req, res) => {
  try {
    const transfers = await CollectionTransfer.find({
      companyId: req.user.companyId,
      $or: [
        { fromBranchId: req.user.branchId || null },
        { toBranchId: req.user.branchId || null },
      ],
    })
      .populate("fromBranchId", "branchName branchCode")
      .populate("toBranchId", "branchName branchCode")
      .sort({ transferDate: -1, createdAt: -1 });
    res.json(transfers);
  } catch (err) {
    res.status(500).json({ message: "Failed to load collection transfers", error: err.message });
  }
};

exports.createTransfer = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const currentBranchId = req.user.branchId || null;
    const {
      transferDate,
      fromBranchId = currentBranchId,
      toBranchId,
      amount,
      paymentMode = "cash",
      fromAccountId = null,
      toAccountId = null,
      remarks = "",
    } = req.body;

    const normalizedAmount = Number(amount || 0);
    if (!fromBranchId || !toBranchId) {
      return res.status(400).json({ message: "fromBranchId and toBranchId are required" });
    }
    if (String(fromBranchId) === String(toBranchId)) {
      return res.status(400).json({ message: "Source and destination branch cannot be same" });
    }
    if (!(normalizedAmount > 0)) {
      return res.status(400).json({ message: "amount must be greater than 0" });
    }

    const branches = await Branch.find({
      companyId,
      _id: { $in: [fromBranchId, toBranchId] },
      status: "active",
    }).lean();
    if (branches.length !== 2) {
      return res.status(400).json({ message: "Invalid branch selection" });
    }

    const effectiveDate = normalizeDate(transferDate);
    if (!effectiveDate) {
      return res.status(400).json({ message: "Invalid transferDate" });
    }

    const count = await CollectionTransfer.countDocuments({ companyId });
    const transfer = await CollectionTransfer.create({
      companyId,
      transferNo: `COL-${count + 1}`,
      fromBranchId,
      toBranchId,
      transferDate: effectiveDate,
      amount: normalizedAmount,
      paymentMode: ["cash", "bank", "mixed"].includes(String(paymentMode).toLowerCase())
        ? String(paymentMode).toLowerCase()
        : "cash",
      fromAccountId,
      toAccountId,
      remarks: String(remarks || "").trim(),
      status: "completed",
      createdBy: req.user.userId,
      completedBy: req.user.userId,
      completedAt: new Date(),
    });

    const populated = await CollectionTransfer.findById(transfer._id)
      .populate("fromBranchId", "branchName branchCode")
      .populate("toBranchId", "branchName branchCode");
    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: "Failed to create collection transfer", error: err.message });
  }
};
