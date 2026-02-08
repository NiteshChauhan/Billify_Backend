import dbConnect from "@/lib/db";
import authMiddleware from "@/middlewares/authMiddleware";
import {
  createPurchaseInvoice,
  getPurchases,
  getPurchaseById,
} from "@/controllers/purchaseController";

export default async function handler(req, res) {
  await dbConnect();

  /* 🔐 AUTH */
  await authMiddleware(req, res);
  if (res.writableEnded) return;

  const { method, query } = req;

  switch (method) {
    case "POST":
      return createPurchaseInvoice(req, res);

    case "GET":
      if (query.id) {
        return getPurchaseById(req, res);
      }
      return getPurchases(req, res);

    default:
      return res.status(405).json({
        message: "Method Not Allowed",
      });
  }
}
