import Vendor from "../models/Vendor";
import SalesInvoice from "../models/SalesInvoice";

export const getVendorAgeing = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const today = new Date();

    const vendors = await Vendor.find({
      companyId,
      isActive: true,
    });

    const report = [];

    for (const vendor of vendors) {
      const invoices = await SalesInvoice.find({
        companyId,
        vendorId: vendor._id,
        status: { $ne: "PAID" },
      });

      let bucket30 = 0;
      let bucket60 = 0;
      let bucket90 = 0;

      invoices.forEach((inv) => {
        const days = Math.floor(
          (today - new Date(inv.invoiceDate)) / (1000 * 60 * 60 * 24),
        );

        const outstanding = (inv.totalAmount || 0) - (inv.paidAmount || 0);

        if (outstanding <= 0) return;

        if (days <= 30) bucket30 += outstanding;
        else if (days <= 60) bucket60 += outstanding;
        else bucket90 += outstanding;
      });

      const total = bucket30 + bucket60 + bucket90;

      if (total > 0) {
        report.push({
          vendorId: vendor._id,
          name: vendor.name,
          "0_30": bucket30,
          "31_60": bucket60,
          "61_plus": bucket90,
          total,
        });
      }
    }

    return res.json(report);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
