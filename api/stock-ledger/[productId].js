import dbConnect from "@/lib/db";
import authMiddleware from "@/middlewares/authMiddleware";
import { getStockLedgerByProduct } from "@/controllers/stockLedgerController";

export default async function handler(req, res) {
  await dbConnect();
  await authMiddleware(req, res);

  if (req.method === "GET") {
    return getStockLedgerByProduct(req, res);
  }

  res.status(405).json({ error: "Method not allowed" });
}
