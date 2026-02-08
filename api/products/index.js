import connectDB from "../../lib/db";
import auth from "../../middlewares/authMiddleware";
import {
  createProduct,
  getProducts,
} from "../../controllers/productController";

export default async function handler(req, res) {
  await connectDB();

  auth(req, res, async () => {
    if (req.method === "POST") {
      return createProduct(req, res);
    }

    if (req.method === "GET") {
      return getProducts(req, res);
    }

    return res.status(405).json({ message: "Method not allowed" });
  });
}
