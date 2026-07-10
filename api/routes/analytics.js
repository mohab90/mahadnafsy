'use strict';
// Analytics module — decomposed into domain sub-routers (weakness #7/#14).
// Every route declares its own absolute /api path, so each sub-router is mounted
// at the router root, matching the hr.js / core.js aggregator pattern.
const { Router } = require('express');
const router = Router();
router.use(require('./analytics/financial'));
router.use(require('./analytics/campaigns'));
router.use(require('./analytics/sales'));
router.use(require('./analytics/leads-scoring'));
router.use(require('./analytics/dashboard'));
module.exports = router;
