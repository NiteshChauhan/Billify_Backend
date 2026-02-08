import connectDB from "../../../lib/db";
import auth from "../../../middlewares/authMiddleware";
import { getPaymentsByInvoice } from "../../../controllers/paymentController";

export default async function handler(req, res) {
  await connectDB();

  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  auth(req, res, async () => {
    await getPaymentsByInvoice(req, res);
  });
}
