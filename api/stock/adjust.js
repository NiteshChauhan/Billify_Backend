import dbConnect from "@/lib/db";
import authMiddleware from "@/middlewares/authMiddleware";
import { adjustStock } from "@/controllers/stockController";

export default async function handler(req, res) {
  await dbConnect();
  await authMiddleware(req, res);

  if (req.method === "POST") {
    return adjustStock(req, res);
  }

  res.status(405).json({ error: "Method not allowed" });
}
