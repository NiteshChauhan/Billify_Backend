import Vendor from "../models/Vendor";

export const createVendor = async (req, res) => {
  try {
    const vendor = await Vendor.create({
      companyId: req.user.companyId,
      ...req.body,
      balance: req.body.openingBalance || 0,
    });

    return res.json(vendor);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

export const getVendors = async (req, res) => {
  const vendors = await Vendor.find({
    companyId: req.user.companyId,
    isActive: true,
  });

  return res.json(vendors);
};

export const updateVendor = async (req, res) => {
  const { id } = req.query;

  const vendor = await Vendor.findOneAndUpdate(
    { _id: id, companyId: req.user.companyId },
    req.body,
    { new: true },
  );

  return res.json(vendor);
};

export const deleteVendor = async (req, res) => {
  const { id } = req.query;

  await Vendor.findOneAndUpdate(
    { _id: id, companyId: req.user.companyId },
    { isActive: false },
  );

  return res.json({ message: "Vendor deactivated" });
};
