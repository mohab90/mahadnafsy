'use strict';
// Admin module — decomposed into domain sub-routers (weakness #7/#14).
// Each route declares its own absolute /api path, so sub-routers mount at root.
const { Router } = require('express');
const router = Router();
router.use(require('./admin/catalog'));
router.use(require('./admin/stafflists'));
router.use(require('./admin/subscribers'));
router.use(require('./admin/leads'));
module.exports = router;
