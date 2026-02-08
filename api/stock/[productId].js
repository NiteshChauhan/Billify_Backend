import dbConnect from "@/lib/db";
import authMiddleware from "@/middlewares/authMiddleware";
import { getProductStock } from "@/controllers/stockController";

export default async function handler(req, res) {
  await dbConnect();
  await authMiddleware(req, res);

  if (req.method === "GET") {
    return getProductStock(req, res);
  }

  res.status(405).json({ error: "Method not allowed" });
}
