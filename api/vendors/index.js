import dbConnect from "../../lib/db";
import authMiddleware from "../../middlewares/authMiddleware";
import { createVendor, getVendors } from "../../controllers/vendorController";

export default async function handler(req, res) {
  try {
    await dbConnect();
    await authMiddleware(req, res);

    if (req.method === "POST") {
      return await createVendor(req, res);
    }

    if (req.method === "GET") {
      return await getVendors(req, res);
    }

    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    return res.status(500).json({
      message: "Vendor API error",
      error: error.message,
    });
  }
}
