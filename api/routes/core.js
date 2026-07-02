'use strict';
// Core module — decomposed into domain sub-routers (weakness #7/#14).
// Each route declares its own absolute /api path, so sub-routers mount at root.
const { Router } = require('express');
const router = Router();
router.use(require('./core/financepay'));
router.use(require('./core/staffacct'));
router.use(require('./core/catalog'));
router.use(require('./core/payops'));
router.use(require('./core/content'));
router.use(require('./core/intake'));
module.exports = router;
