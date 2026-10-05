'use strict';
// The CRM's lead routes.
//
// This was one file of 2,400 lines; each concern is a file under
// routes/admin/leads/ now. Their routes are put back on this one router in the
// order they were always matched — the layers copied in, not mounted with
// router.use — so every route sits exactly where it did: /leads/stats and the
// other fixed paths still come before /leads/:id, and the registry, the
// shadowing checks and every test that looks a handler up on this router see
// the same flat list.
const { Router } = require('express');

const router = Router();

const PARTS = [
  'write', 'importDaqqi', 'assignment', 'dedup', 'convert', 'insights', 'stats', 'lists',
];
for (const part of PARTS) router.stack.push(...require(`./leads/${part}`).stack);

module.exports = router;
module.exports.indexedLeadSearch = require('./leads/lists').indexedLeadSearch;
