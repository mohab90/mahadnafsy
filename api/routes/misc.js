'use strict';
// Misc module — decomposed into domain sub-routers (weakness #7/#14).
// Shared helpers + self-invoking schedulers live in ./misc/_shared.js (loaded
// once); each route sub-router mounts at root (routes use absolute /api paths).
const { Router } = require('express');
const router = Router();
router.use(require('./misc/messaging'));
router.use(require('./misc/billing'));
router.use(require('./misc/analytics'));
router.use(require('./misc/reminders'));
router.use(require('./misc/admincfg'));
module.exports = router;
