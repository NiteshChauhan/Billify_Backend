import dbConnect from "@/lib/db";
import authMiddleware from "@/middlewares/authMiddleware";
import { createSalesInvoice, getSales } from "@/controllers/salesController";

export default async function handler(req, res) {
  await dbConnect();
  await authMiddleware(req, res);

  if (req.method === "POST") {
    return createSalesInvoice(req, res);
  }

  if (req.method === "GET") {
    return getSales(req, res);
  }

  res.status(405).json({ error: "Method not allowed" });
}
