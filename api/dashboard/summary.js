import connectDB from "../../lib/db";
import auth from "../../middlewares/authMiddleware";
import { getDashboardSummary } from "../../controllers/dashboardController";

export default async function handler(req, res) {
  await connectDB();

  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  // Run auth middleware manually
  auth(req, res, async () => {
    await getDashboardSummary(req, res);
  });
}
