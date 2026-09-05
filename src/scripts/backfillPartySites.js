const connectDB = require("../config/db");

const Site = require("../models/Site");
const PartySite = require("../models/PartySite");

const run = async () => {
  await connectDB();
  const summary = {
    scanned: 0,
    created: 0,
    existing: 0,
    skipped: 0,
  };

  const sites = await Site.find({
    isDeleted: false,
    partyId: { $exists: true, $ne: null },
  }).select("_id adminId branchId partyId createdBy updatedBy");

  for (const site of sites) {
    summary.scanned += 1;
    if (!site.adminId || !site.partyId) {
      summary.skipped += 1;
      continue;
    }

    const result = await PartySite.updateOne(
      {
        adminId: site.adminId,
        partyId: site.partyId,
        siteId: site._id,
        isDeleted: false,
      },
      {
        $setOnInsert: {
          adminId: site.adminId,
          branchId: site.branchId || null,
          partyId: site.partyId,
          siteId: site._id,
          status: "active",
          createdBy: site.createdBy || null,
        },
        $set: {
          updatedBy: site.updatedBy || site.createdBy || null,
        },
      },
      { upsert: true },
    );

    if (result.upsertedCount) summary.created += 1;
    else summary.existing += 1;
  }

  console.log("PartySite backfill summary:", summary);
  process.exit(0);
};

run().catch((err) => {
  console.error("PartySite backfill failed:", err);
  process.exit(1);
});
