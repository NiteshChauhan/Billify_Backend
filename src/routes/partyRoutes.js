const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const partyController = require("../controllers/partyController");
const partyLedgerController = require("../controllers/partyLedgerController");

router.use(auth);

/* CREATE */
router.post("/", partyController.createParty);

/* GET */
router.get("/", partyController.getAllParties);
router.get("/suppliers", partyController.getSuppliers);
router.get("/vendors", partyController.getVendors);
router.get("/customers", partyController.getCustomers);
router.get("/:id", partyController.getPartyById);
router.get("/:id/ledger", (req, res) => {
  req.params.partyId = req.params.id;
  return partyLedgerController.getPartyLedger(req, res);
});
router.get("/:id/ledger/pdf", (req, res) => {
  req.params.partyId = req.params.id;
  return partyLedgerController.exportPartyLedgerPdf(req, res);
});

/* UPDATE */
router.put("/:id", partyController.updateParty);

/* DELETE */
router.delete("/:id", partyController.deleteParty);

module.exports = router;
