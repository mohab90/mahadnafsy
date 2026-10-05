'use strict';
// Each course's and track's price at every branch, its discount prices, and
// its booking bonuses (lib/priceTiers.js).
//
//   GET /api/admin/catalog-pricing             every item — the booking screen prices from it
//                                              (whoever records payments or edits courses)
//   GET /api/admin/catalog-pricing/:type/:id   one item — the course editor
//   PUT /api/admin/catalog-pricing/:type/:id   {tiers:{TIER:{price,discountPrice}}, bonuses}
const express = require('express');
const logger = require('../lib/logger').child({ route: 'catalog-pricing' });
const { pool, cacheInvalidate } = require('../lib/db');
const { requireAuth, requireAdminOrStaff, requirePermission, requireAnyPermission } = require('../middleware/auth');
const { PRICE_TIERS, getItemPricing, listCatalogPricing, saveItemPricing } = require('../lib/priceTiers');

const router = express.Router();
const TYPES = new Set(['course', 'bundle']);

router.get('/api/admin/catalog-pricing', requireAuth, requireAdminOrStaff, requireAnyPermission('manage_payments', 'manage_courses'), async (req, res) => {
  try {
    res.json({ tiers: PRICE_TIERS, items: await listCatalogPricing(pool, req.tenantId) });
  } catch (e) { logger.error('[catalog-pricing list]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/api/admin/catalog-pricing/:type/:id', requireAuth, requireAdminOrStaff, requireAnyPermission('manage_payments', 'manage_courses'), async (req, res) => {
  try {
    if (!TYPES.has(req.params.type)) return res.status(400).json({ error: 'type must be course or bundle' });
    const pricing = await getItemPricing(pool, { tenantId: req.tenantId, type: req.params.type, itemId: req.params.id });
    if (!pricing) return res.status(404).json({ error: 'الكورس أو المسار مش موجود' });
    res.json({ tiers: PRICE_TIERS, ...pricing });
  } catch (e) { logger.error('[catalog-pricing get]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/api/admin/catalog-pricing/:type/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_courses'), async (req, res) => {
  if (!TYPES.has(req.params.type)) return res.status(400).json({ error: 'type must be course or bundle' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await saveItemPricing(conn, {
      tenantId: req.tenantId,
      type: req.params.type,
      itemId: req.params.id,
      tiers: req.body?.tiers,
      bonuses: req.body?.bonuses,
      staffId: req.staffRecord?.id || null,
    });
    await conn.commit();
    // The public catalogue is cached; the online tiers just rewrote its prices.
    cacheInvalidate('courses', 'bundles');
    const pricing = await getItemPricing(pool, { tenantId: req.tenantId, type: req.params.type, itemId: req.params.id });
    res.json({ ok: true, tiers: PRICE_TIERS, ...pricing });
  } catch (e) {
    await conn.rollback().catch(() => {});
    if (e.status) return res.status(e.status).json({ error: e.message });
    logger.error('[catalog-pricing put]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

module.exports = router;
