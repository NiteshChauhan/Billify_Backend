import dbConnect from "../../lib/db";
import authMiddleware from "../../middlewares/authMiddleware";
import {
  createSupplier,
  getSuppliers,
} from "../../controllers/supplierController";

export default async function handler(req, res) {
  try {
    await dbConnect();
    await authMiddleware(req, res);

    if (req.method === "POST") {
      return await createSupplier(req, res);
    }

    if (req.method === "GET") {
      return await getSuppliers(req, res);
    }

    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    return res.status(500).json({
      message: "Supplier API error",
      error: error.message,
    });
  }
}
