import Supplier from "@/models/Supplier";
import PurchaseInvoice from "@/models/PurchaseInvoice";

/* ================= SUPPLIER OUTSTANDING ================= */
export const getSupplierOutstanding = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    /* 🔹 ACTIVE SUPPLIERS */
    const suppliers = await Supplier.find({
      companyId,
      isActive: true,
    });

    const supplierIds = suppliers.map((s) => s._id);

    /* 🔹 ALL PURCHASE INVOICES */
    const invoices = await PurchaseInvoice.find({
      companyId,
      supplierId: { $in: supplierIds },
    });

    /* 🔹 MAP INVOICES BY SUPPLIER */
    const invoiceMap = {};

    invoices.forEach((inv) => {
      const sid = inv.supplierId.toString();

      if (!invoiceMap[sid]) {
        invoiceMap[sid] = {
          totalPurchase: 0,
          totalPaid: 0,
        };
      }

      invoiceMap[sid].totalPurchase += inv.totalAmount || 0;
      invoiceMap[sid].totalPaid += inv.paidAmount || 0;
    });

    /* 🔹 FINAL REPORT */
    const report = suppliers.map((supplier) => {
      const data = invoiceMap[supplier._id.toString()] || {
        totalPurchase: 0,
        totalPaid: 0,
      };

      const outstanding =
        (supplier.openingBalance || 0) + data.totalPurchase - data.totalPaid;

      return {
        supplierId: supplier._id,
        supplierName: supplier.name,
        totalPurchase: data.totalPurchase,
        totalPaid: data.totalPaid,
        outstanding,
      };
    });

    res.json(report);
  } catch (err) {
    console.error("Supplier Outstanding Error:", err);
    res.status(500).json({
      error: "Failed to load supplier outstanding report",
    });
  }
};
