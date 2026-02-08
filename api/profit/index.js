import connectDB from "../../lib/db";
import auth from "../../middlewares/authMiddleware";
import { getProfit } from "../../controllers/profitController";

export default async function handler(req, res) {
  await connectDB();

  auth(req, res, async () => {
    if (req.method === "GET") {
      return getProfit(req, res);
    }

    return res.status(405).json({ message: "Method not allowed" });
  });
}
