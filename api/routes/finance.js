'use strict';
// Receipts and invoices, the accounting reports, payment links, the finance
// cockpit, budgets and refunds.
//
// This was one file of 1,700 lines; each concern is a file under
// routes/finance/ now. Their routes are put back on this one router in the
// order they were always matched — the layers copied in, not mounted with
// router.use — so every route sits exactly where it did and every test that
// looks a handler up on this router sees the same flat list.
const { Router } = require('express');

const router = Router();

const PARTS = ['documents', 'reports', 'paymentLinks', 'cockpit', 'budgets', 'refunds'];
for (const part of PARTS) router.stack.push(...require(`./finance/${part}`).stack);

module.exports = router;
