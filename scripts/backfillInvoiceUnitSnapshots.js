require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const Product = require("../src/models/Product");
const SalesInvoice = require("../src/models/SalesInvoice");
const PurchaseInvoice = require("../src/models/PurchaseInvoice");

const buildProductSnapshotMap = async () => {
  const products = await Product.find({})
    .setOptions({ withDeleted: true })
    .select("name unitId unitName")
    .lean();

  return new Map(
    products.map((product) => [
      String(product._id),
      {
        productName: product.name || "",
        unitId: product.unitId || null,
        unitName: product.unitName || "",
      },
    ]),
  );
};

const backfillInvoiceModel = async (Model, productMap, { includeProductName = false } = {}) => {
  let scanned = 0;
  let updated = 0;
  const cursor = Model.find({ "items.productId": { $exists: true, $ne: null } })
    .setOptions({ withDeleted: true })
    .cursor();

  for await (const invoice of cursor) {
    scanned += 1;
    let changed = false;

    invoice.items.forEach((item) => {
      if (!item.productId) return;
      const snapshot = productMap.get(String(item.productId));
      if (!snapshot) return;

      if (!item.unitId && snapshot.unitId) {
        item.unitId = snapshot.unitId;
        changed = true;
      }
      if (!item.unitName && snapshot.unitName) {
        item.unitName = snapshot.unitName;
        changed = true;
      }
      if (includeProductName && !item.productName && snapshot.productName) {
        item.productName = snapshot.productName;
        changed = true;
      }
    });

    if (changed) {
      await invoice.save();
      updated += 1;
    }
  }

  return { scanned, updated };
};

const run = async () => {
  await connectDB();
  const productMap = await buildProductSnapshotMap();
  const sales = await backfillInvoiceModel(SalesInvoice, productMap);
  const purchases = await backfillInvoiceModel(PurchaseInvoice, productMap, { includeProductName: true });

  console.log("Invoice unit snapshot backfill complete");
  console.log({ sales, purchases });
  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error("Invoice unit snapshot backfill failed", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
