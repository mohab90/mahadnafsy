'use strict';
// ── SaaS control-plane admin API ──────────────────────────────────────────────
// Read/write the SaaS control tables (tenants / saas_plans / tenant_subscriptions
// / feature_flags) created by migration 027. Touches NO existing business query,
// so it's safe to ship; it simply exposes the multi-tenant control plane to the
// super-admin. Becomes fully live once migrations 027/028 are applied.
const express = require('express');
const { uuidv4 } = require('../lib/id');
const { pool, cacheInvalidate } = require('../lib/db');
const logger = require('../lib/logger');
const { loadTenantContext } = require('../lib/tenantScope');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');

const router = express.Router();
const slugify = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);

// GET /api/admin/saas/tenants — tenants with their active plan.
router.get('/api/admin/saas/tenants', requireAuth, requireSuperAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT t.id, t.slug, t.name, t.status, t.plan_key, t.created_at,
             ts.status AS subscription_status, sp.name AS plan_name, sp.plan_key AS active_plan_key
      FROM tenants t
      LEFT JOIN tenant_subscriptions ts ON ts.tenant_id = t.id
        AND ts.status IN ('active','trialing')
      LEFT JOIN saas_plans sp ON sp.id = ts.plan_id
      GROUP BY t.id
      ORDER BY t.created_at ASC`);
    res.json(rows);
  } catch (e) { logger.error('[saas]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/saas/tenants — provision a new tenant (+ trial subscription).
router.post('/api/admin/saas/tenants', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const slug = slugify(req.body.slug || req.body.name);
    if (!name) return res.status(400).json({ error: 'الاسم مطلوب' });
    if (!slug) return res.status(400).json({ error: 'المعرّف (slug) غير صالح' });
    const [[dupe]] = await pool.query('SELECT id FROM tenants WHERE slug=? LIMIT 1', [slug]);
    if (dupe) return res.status(409).json({ error: 'هذا المعرّف مستخدم بالفعل' });
    const planKey = req.body.plan_key || null;
    const id = uuidv4();
    await pool.query(
      `INSERT INTO tenants (id, slug, name, status, plan_key, default_locale, default_timezone)
       VALUES (?,?,?, 'active', ?, ?, ?)`,
      [id, slug, name, planKey, req.body.default_locale || 'ar-EG', req.body.default_timezone || 'Africa/Cairo']);
    // Attach a trial subscription if a plan was chosen.
    let planId = null;
    if (planKey) { const [[p]] = await pool.query('SELECT id FROM saas_plans WHERE plan_key=? LIMIT 1', [planKey]); planId = p?.id || null; }
    await pool.query(
      `INSERT INTO tenant_subscriptions (id, tenant_id, plan_id, status, starts_at, trial_ends_at)
       VALUES (?,?,?, 'trialing', NOW(), DATE_ADD(NOW(), INTERVAL 14 DAY))`,
      [uuidv4(), id, planId]);
    cacheInvalidate('tenant_index'); // so subdomain routing resolves the new tenant immediately
    logger.info(`[saas] provisioned tenant ${slug} (${id})`);
    res.json({ ok: true, id, slug, name, status: 'active' });
  } catch (e) { logger.error('[saas provision]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// PATCH /api/admin/saas/tenants/:id — status (active/suspended/archived), name, plan.
router.patch('/api/admin/saas/tenants/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const [[t]] = await pool.query('SELECT id FROM tenants WHERE id=? LIMIT 1', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Not found' });
    const sets = [], vals = [];
    if (req.body.status && ['active', 'suspended', 'archived'].includes(req.body.status)) { sets.push('status=?'); vals.push(req.body.status); }
    if (req.body.name) { sets.push('name=?'); vals.push(String(req.body.name).trim()); }
    if (Object.prototype.hasOwnProperty.call(req.body, 'plan_key')) { sets.push('plan_key=?'); vals.push(req.body.plan_key || null); }
    if (!sets.length) return res.status(400).json({ error: 'لا يوجد تغيير' });
    vals.push(req.params.id);
    await pool.query(`UPDATE tenants SET ${sets.join(', ')} WHERE id=?`, vals);
    cacheInvalidate('tenant_index');
    res.json({ ok: true });
  } catch (e) { logger.error('[saas patch]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/saas/plans
router.get('/api/admin/saas/plans', requireAuth, requireSuperAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, plan_key, name, billing_cycle, base_price, currency, feature_limits_json, is_active FROM saas_plans ORDER BY base_price ASC');
    res.json(rows);
  } catch (e) { logger.error('[saas]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/saas/feature-flags?tenant_id=...  (global flags have tenant_id NULL)
router.get('/api/admin/saas/feature-flags', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const tid = req.query.tenant_id || null;
    const [rows] = await pool.query(
      'SELECT id, tenant_id, flag_key, is_enabled, config_json, updated_at FROM feature_flags WHERE tenant_id = ? OR tenant_id IS NULL ORDER BY flag_key',
      [tid]);
    res.json(rows);
  } catch (e) { logger.error('[saas]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/saas/feature-flags — upsert a flag { tenant_id?, flag_key, is_enabled, config }
router.post('/api/admin/saas/feature-flags', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const flagKey = String(req.body.flag_key || '').trim();
    if (!flagKey) return res.status(400).json({ error: 'flag_key required' });
    const tenantId = req.body.tenant_id || null;
    const isEnabled = req.body.is_enabled ? 1 : 0;
    const configJson = req.body.config ? JSON.stringify(req.body.config) : null;
    await pool.query(
      `INSERT INTO feature_flags (id, tenant_id, flag_key, is_enabled, config_json)
       VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE is_enabled=VALUES(is_enabled), config_json=VALUES(config_json)`,
      [uuidv4(), tenantId, flagKey, isEnabled, configJson]);
    res.json({ ok: true });
  } catch (e) { logger.error('[saas]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/saas/status — the current request's resolved tenant context
// (tenant + plan + effective feature set). Confirms the tenant plumbing end-to-end.
router.get('/api/admin/saas/status', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const ctx = await loadTenantContext(req.tenantId);
    res.json({ resolvedTenantId: req.tenantId || null, context: ctx });
  } catch (e) { logger.error('[saas]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
