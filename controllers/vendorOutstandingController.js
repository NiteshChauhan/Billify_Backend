import Vendor from "../models/Vendor";
import SalesInvoice from "../models/SalesInvoice";

export const getVendorOutstanding = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    const vendors = await Vendor.find({
      companyId,
      isActive: true,
    });

    const vendorIds = vendors.map((v) => v._id);

    const invoices = await SalesInvoice.find({
      companyId,
      vendorId: { $in: vendorIds },
    });

    const invoiceMap = {};

    invoices.forEach((inv) => {
      const vid = inv.vendorId.toString();

      if (!invoiceMap[vid]) {
        invoiceMap[vid] = {
          totalSales: 0,
          totalReceived: 0,
        };
      }

      invoiceMap[vid].totalSales += inv.totalAmount || 0;
      invoiceMap[vid].totalReceived += inv.paidAmount || 0;
    });

    const report = vendors.map((vendor) => {
      const data = invoiceMap[vendor._id.toString()] || {
        totalSales: 0,
        totalReceived: 0,
      };

      const outstanding =
        (vendor.openingBalance || 0) + data.totalSales - data.totalReceived;

      return {
        vendorId: vendor._id,
        vendorName: vendor.name,
        totalSales: data.totalSales,
        totalReceived: data.totalReceived,
        outstanding,
      };
    });

    return res.json(report);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
