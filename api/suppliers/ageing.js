import dbConnect from "../../lib/db";
import authMiddleware from "../../middlewares/authMiddleware";
import { getVendorAgeing } from "../../controllers/supplierAgeingController";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await dbConnect();
    await authMiddleware(req, res);

    return await getVendorAgeing(req, res);
  } catch (error) {
    return res.status(500).json({
      message: "Supplier ageing error",
      error: error.message,
    });
  }
}
