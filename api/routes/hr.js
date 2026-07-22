'use strict';
// HR module — decomposed into domain sub-routers (weakness #7/#14).
// Every route declares its own absolute /api path, so each sub-router is mounted
// at the router root; shared deps + _resolveStaffByUser live in ./hr/_shared.js.
const { Router } = require('express');
const router = Router();
router.use(require('./hr/employees'));
router.use(require('./hr/attendance'));
router.use(require('./hr/payroll'));
router.use(require('./hr/recruiting'));
router.use(require('./hr/reports'));
router.use(require('./hr/records'));
router.use(require('./hr/compensation'));
router.use(require('./hr/offboarding'));
router.use(require('./hr/enps'));
router.use(require('./hr/talent').router); // website join-us → recruiting bridge
module.exports = router;
