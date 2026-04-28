const router = require("express").Router();
const auth = require("../middlewares/authMiddleware");
const report = require("../controllers/reportController");
const partyOutstanding = require("../controllers/partyOutstandingController");
const partyLedger = require("../controllers/partyLedgerController");
const ledgerList = require("../controllers/ledgerListController");

router.use(auth);

/* STOCK */
router.get("/stock", report.stockReport);

/* PURCHASE & SALES */
router.get("/purchase", report.purchaseReport);
router.get("/sales", report.salesReport);
router.get("/daily", report.dailyReport);
router.get("/daybook/balance-history", report.dayBookBalanceHistory);
router.get("/fifo-debug", report.fifoDebug);

/* PROFIT & LOSS */
router.get("/profit-loss", report.profitLossReport);

/* PARTY LEDGER */
router.get("/ledger/:partyId", partyLedger.getPartyLedger);
router.get("/ledger/:partyId/pdf", partyLedger.exportPartyLedgerPdf);
router.get("/ledger-list", ledgerList.getLedgerList);
router.get("/ledger-transactions", ledgerList.getLedgerTransactions);

/* OUTSTANDING */
router.get("/outstanding/suppliers", partyOutstanding.getSupplierOutstanding);
router.get("/outstanding/vendors", partyOutstanding.getVendorOutstanding);
router.get("/outstanding/customers", partyOutstanding.getCustomerOutstanding);
router.get("/outstanding/all", partyOutstanding.getAllOutstanding);
router.get("/outstanding", partyOutstanding.getOutstandingByRole);
router.get("/ageing", partyOutstanding.getAgeingByRole);

module.exports = router;
