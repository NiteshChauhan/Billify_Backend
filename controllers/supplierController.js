import Supplier from "../models/Supplier";

export const createSupplier = async (req, res) => {
  try {
    const supplier = await Supplier.create({
      companyId: req.user.companyId,
      ...req.body,
      balance: req.body.openingBalance || 0,
    });

    return res.json(supplier);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

export const getSuppliers = async (req, res) => {
  const suppliers = await Supplier.find({
    companyId: req.user.companyId,
    isActive: true,
  });

  return res.json(suppliers);
};

export const updateSupplier = async (req, res) => {
  const { id } = req.query; // ⬅️ Vercel

  const supplier = await Supplier.findOneAndUpdate(
    { _id: id, companyId: req.user.companyId },
    req.body,
    { new: true },
  );

  return res.json(supplier);
};

export const deleteSupplier = async (req, res) => {
  const { id } = req.query; // ⬅️ Vercel

  await Supplier.findOneAndUpdate(
    { _id: id, companyId: req.user.companyId },
    { isActive: false },
  );

  return res.json({ message: "Supplier deactivated" });
};
