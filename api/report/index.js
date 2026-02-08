import dbConnect from "@/lib/db";
import authMiddleware from "@/middlewares/authMiddleware";

import {
  stockReport,
  supplierDueReport,
  vendorDueReport,
  purchaseReport,
  salesReport,
  profitLossReport,
  partyLedger,
} from "@/controllers/reportController";

import { getSupplierOutstanding } from "@/controllers/supplierOutstandingController";

export default async function handler(req, res) {
  await dbConnect();

  /* 🔐 AUTH */
  await authMiddleware(req, res);
  if (res.writableEnded) return;

  const { method, query } = req;

  if (method !== "GET") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  switch (query.type) {
    case "stock":
      return stockReport(req, res);

    case "supplier-due":
      return supplierDueReport(req, res);

    case "vendor-due":
      return vendorDueReport(req, res);

    case "purchase":
      return purchaseReport(req, res);

    case "sales":
      return salesReport(req, res);

    case "profit-loss":
      return profitLossReport(req, res);

    case "ledger":
      return partyLedger(req, res);

    case "supplier-outstanding":
      return getSupplierOutstanding(req, res);

    default:
      return res.status(400).json({
        message: "Invalid report type",
      });
  }
}
