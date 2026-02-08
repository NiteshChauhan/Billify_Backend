import dbConnect from "../../lib/db";
import authMiddleware from "../../middlewares/authMiddleware";
import { getSupplierLedger } from "../../controllers/supplierLedgerController";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await dbConnect();

    // 🔐 Auth
    await authMiddleware(req, res);

    // 📒 Controller
    return await getSupplierLedger(req, res);
  } catch (error) {
    console.error("Supplier Ledger API Error:", error);
    return res.status(500).json({
      message: "Internal Server Error",
      error: error.message,
    });
  }
}
