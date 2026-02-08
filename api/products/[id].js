import connectDB from "../../lib/db";
import auth from "../../middlewares/authMiddleware";
import {
  getProductById,
  updateProduct,
  deleteProduct,
} from "../../controllers/productController";

export default async function handler(req, res) {
  await connectDB();

  auth(req, res, async () => {
    if (req.method === "GET") {
      return getProductById(req, res);
    }

    if (req.method === "PUT") {
      return updateProduct(req, res);
    }

    if (req.method === "DELETE") {
      return deleteProduct(req, res);
    }

    return res.status(405).json({ message: "Method not allowed" });
  });
}
