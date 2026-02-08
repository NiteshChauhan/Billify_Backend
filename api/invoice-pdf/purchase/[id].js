import connectDB from "../../../lib/db";
import auth from "../../../middlewares/authMiddleware";
import { purchaseInvoicePDF } from "../../../controllers/invoicePdfController";

export default async function handler(req, res) {
  await connectDB();

  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  auth(req, res, async () => {
    await purchaseInvoicePDF(req, res);
  });
}
