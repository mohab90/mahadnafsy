'use strict';
// The owner's switches for the Egypt site's two prices (lib/egyptianPricing.js), and the list that shows what the site will print before they are on.
//
//   GET /api/admin/egyptian-pricing   { settings: {enabled, offerActive}, items: [every course and track with both prices] }
//   PUT /api/admin/egyptian-pricing   { enabled, offerActive } — finance / owner only, audited
const express = require('express');
const logger = require('../lib/logger').child({ route: 'egyptian-pricing' });
const { pool, cacheInvalidate } = require('../lib/db');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { setTenantSetting } = require('../lib/tenantSettings');
const { writeAuditEvent } = require('../lib/auditTrail');
const { SECTION, loadSettings, listForOwner } = require('../lib/egyptianPricing');

const router = express.Router();

router.get('/api/admin/egyptian-pricing', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  try {
    res.json({ settings: await loadSettings(pool, req.tenantId), items: await listForOwner(pool, req.tenantId) });
  } catch (e) { logger.error('[egyptian-pricing get]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/api/admin/egyptian-pricing', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  try {
    const body = req.body || {};
    if (typeof body.enabled !== 'boolean' || (body.offerActive !== undefined && typeof body.offerActive !== 'boolean')) {
      return res.status(400).json({ error: 'القيم لازم تكون تشغيل أو إيقاف', code: 'INVALID_SETTING' });
    }
    const before = await loadSettings(pool, req.tenantId);
    // The offer lives inside the feature: it is stored off whenever the feature is off, so switching the feature back on later does not bring an old offer back by itself.
    const next = { enabled: body.enabled, offerActive: body.enabled && (body.offerActive ?? before.offerActive) === true };
    await setTenantSetting(SECTION, next, { tenantId: req.tenantId, actorId: req.user?.uid || req.user?.email });
    await writeAuditEvent({
      action: 'admin.egyptian_pricing.updated', entityType: 'tenant_settings', entityId: SECTION,
      metadata: { before, after: next }, req,
    });
    // The public catalogue and its prices are cached; they change with this.
    cacheInvalidate('courses', 'bundles', 'public-prices');
    res.json({ ok: true, settings: next });
  } catch (e) { logger.error('[egyptian-pricing put]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
