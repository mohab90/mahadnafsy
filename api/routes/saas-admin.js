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
const { DEFAULT_FEATURES, clearTenantContextCache, loadTenantContext } = require('../lib/tenantScope');
const { requireAuth, requirePlatformAdmin } = require('../middleware/auth');

const router = express.Router();
const slugify = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);

// GET /api/admin/saas/tenants — tenants with their active plan.
router.get('/api/admin/saas/tenants', requireAuth, requirePlatformAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT t.id, t.slug, t.name, t.status, t.plan_key, t.created_at,
             ts.status AS subscription_status, sp.name AS plan_name, sp.plan_key AS active_plan_key
      FROM tenants t
      LEFT JOIN tenant_subscriptions ts ON ts.id = (
        SELECT current_ts.id
        FROM tenant_subscriptions current_ts
        WHERE current_ts.tenant_id=t.id
        ORDER BY FIELD(current_ts.status,'active','trialing','past_due','expired','cancelled'),
                 current_ts.created_at DESC
        LIMIT 1
      )
      LEFT JOIN saas_plans sp ON sp.id = ts.plan_id
      ORDER BY t.created_at ASC`);
    res.json(rows);
  } catch (e) { logger.error('[saas]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/saas/tenants — provision a new tenant (+ trial subscription).
router.post('/api/admin/saas/tenants', requireAuth, requirePlatformAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const name = String(req.body.name || '').trim();
    const slug = slugify(req.body.slug || req.body.name);
    if (!name) return res.status(400).json({ error: 'الاسم مطلوب' });
    if (!slug) return res.status(400).json({ error: 'المعرّف (slug) غير صالح' });
    const [[dupe]] = await conn.query('SELECT id FROM tenants WHERE slug=? LIMIT 1', [slug]);
    if (dupe) return res.status(409).json({ error: 'هذا المعرّف مستخدم بالفعل' });
    const planKey = String(req.body.plan_key || '').trim();
    if (!planKey) return res.status(400).json({ error: 'الخطة مطلوبة عند إنشاء المؤسسة' });
    const [[plan]] = await conn.query('SELECT id FROM saas_plans WHERE plan_key=? AND is_active=1 LIMIT 1', [planKey]);
    if (!plan) return res.status(400).json({ error: 'الخطة غير موجودة أو غير مفعلة' });
    const planId = plan.id;
    const id = uuidv4();
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO tenants (id, slug, name, status, plan_key, default_locale, default_timezone)
       VALUES (?,?,?, 'active', ?, ?, ?)`,
      [id, slug, name, planKey, req.body.default_locale || 'ar-EG', req.body.default_timezone || 'Africa/Cairo']);
    await conn.query(
      `INSERT INTO tenant_subscriptions
         (id, tenant_id, active_tenant_id, plan_id, status, starts_at, trial_ends_at)
       VALUES (?,?,?, ?, 'trialing', NOW(), DATE_ADD(NOW(), INTERVAL 14 DAY))`,
      [uuidv4(), id, id, planId]);
    await conn.commit();
    cacheInvalidate('tenant_index'); // so subdomain routing resolves the new tenant immediately
    clearTenantContextCache(id);
    logger.info(`[saas] provisioned tenant ${slug} (${id})`);
    res.json({ ok: true, id, slug, name, status: 'active' });
  } catch (e) {
    await conn.rollback().catch(() => {});
    logger.error('[saas provision]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// PATCH /api/admin/saas/tenants/:id — status (active/suspended/archived), name, plan.
router.patch('/api/admin/saas/tenants/:id', requireAuth, requirePlatformAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[t]] = await conn.query('SELECT id FROM tenants WHERE id=? LIMIT 1 FOR UPDATE', [req.params.id]);
    if (!t) {
      await conn.rollback();
      return res.status(404).json({ error: 'Not found' });
    }
    const sets = [], vals = [];
    if (req.body.status !== undefined) {
      if (!['active', 'suspended', 'archived'].includes(req.body.status)) {
        await conn.rollback();
        return res.status(400).json({ error: 'Invalid tenant status' });
      }
      sets.push('status=?'); vals.push(req.body.status);
    }
    if (req.body.name !== undefined) {
      const name = String(req.body.name || '').trim();
      if (!name) { await conn.rollback(); return res.status(400).json({ error: 'Tenant name is required' }); }
      sets.push('name=?'); vals.push(name);
    }
    const changesPlan = Object.prototype.hasOwnProperty.call(req.body, 'plan_key');
    let planId = null;
    if (changesPlan) {
      const planKey = String(req.body.plan_key || '').trim();
      if (!planKey) {
        await conn.rollback();
        return res.status(400).json({ error: 'لا يمكن تفعيل مؤسسة بدون خطة' });
      }
      const [[plan]] = await conn.query('SELECT id FROM saas_plans WHERE plan_key=? AND is_active=1 LIMIT 1', [planKey]);
      if (!plan) {
        await conn.rollback();
        return res.status(400).json({ error: 'الخطة غير موجودة أو غير مفعلة' });
      }
      planId = plan.id;
      sets.push('plan_key=?');
      vals.push(planKey);
    }
    if (!sets.length) {
      await conn.rollback();
      return res.status(400).json({ error: 'لا يوجد تغيير' });
    }
    vals.push(req.params.id);
    await conn.query(`UPDATE tenants SET ${sets.join(', ')} WHERE id=?`, vals);
    if (changesPlan) {
      const [[subscription]] = await conn.query(
        `SELECT id FROM tenant_subscriptions
         WHERE tenant_id=? AND status IN ('active','trialing','past_due')
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [req.params.id]
      );
      if (subscription) {
        await conn.query('UPDATE tenant_subscriptions SET plan_id=? WHERE id=? AND tenant_id=?', [
          planId, subscription.id, req.params.id,
        ]);
      } else {
        await conn.query(
          `INSERT INTO tenant_subscriptions
             (id, tenant_id, active_tenant_id, plan_id, status, starts_at)
           VALUES (?, ?, ?, ?, 'active', NOW())`,
          [uuidv4(), req.params.id, req.params.id, planId]
        );
      }
    }
    await conn.commit();
    cacheInvalidate('tenant_index');
    clearTenantContextCache(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback().catch(() => {});
    logger.error('[saas patch]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// ── DB backups (ops) ─────────────────────────────────────────────────────────
// POST /api/admin/db-backup/run — trigger a backup now (idempotent per day).
router.post('/api/admin/db-backup/run', requireAuth, requirePlatformAdmin, async (_req, res) => {
  try {
    const wrote = await require('../lib/dbBackup').runBackup();
    res.json({ ok: true, wrote, note: wrote ? 'تم إنشاء نسخة جديدة' : 'نسخة اليوم موجودة بالفعل' });
  } catch (e) { logger.error('[db-backup run]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/db-backup/list — list stored backups (name, size, date).
router.get('/api/admin/db-backup/list', requireAuth, requirePlatformAdmin, async (_req, res) => {
  try {
    const fs = require('fs'); const path = require('path'); const { DIR } = require('../lib/dbBackup');
    let files = [];
    try {
      files = fs.readdirSync(DIR).filter(f => f.endsWith('.sql.gz')).map(f => {
        const st = fs.statSync(path.join(DIR, f));
        return { name: f, sizeMB: +(st.size / 1048576).toFixed(2), at: st.mtime };
      }).sort((a, b) => (a.name < b.name ? 1 : -1));
    } catch { /* dir not created yet */ }
    res.json({ dir: DIR, count: files.length, files });
  } catch (e) { logger.error('[db-backup list]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/saas/plans
router.get('/api/admin/saas/plans', requireAuth, requirePlatformAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, plan_key, name, billing_cycle, base_price, currency, feature_limits_json, is_active FROM saas_plans ORDER BY base_price ASC');
    res.json(rows);
  } catch (e) { logger.error('[saas]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.patch('/api/admin/saas/plans/:id', requireAuth, requirePlatformAdmin, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection(); await conn.beginTransaction();
    const [[plan]] = await conn.query('SELECT id, feature_limits_json FROM saas_plans WHERE id=? LIMIT 1 FOR UPDATE', [req.params.id]);
    if (!plan) { await conn.rollback(); conn.release(); conn = null; return res.status(404).json({ error: 'Plan not found' }); }
    const sets = [], values = [];
    if (req.body.name !== undefined) {
      const name = String(req.body.name || '').trim();
      if (!name) { await conn.rollback(); conn.release(); conn = null; return res.status(400).json({ error: 'Plan name is required' }); }
      sets.push('name=?'); values.push(name);
    }
    if (req.body.base_price !== undefined) {
      const price = Number(req.body.base_price);
      if (!Number.isFinite(price) || price < 0) { await conn.rollback(); conn.release(); conn = null; return res.status(400).json({ error: 'Invalid base price' }); }
      sets.push('base_price=?'); values.push(price);
    }
    if (req.body.is_active !== undefined) {
      sets.push('is_active=?'); values.push(req.body.is_active ? 1 : 0);
    }
    if (req.body.feature_limits !== undefined) {
      const limits = req.body.feature_limits;
      if (!limits || typeof limits !== 'object' || Array.isArray(limits)) {
        await conn.rollback(); conn.release(); conn = null;
        return res.status(400).json({ error: 'feature_limits must be an object' });
      }
      const allowedLimits = new Set(['branches', 'staff', 'courses', 'users']);
      const numericEntries = Object.entries(limits).filter(([key]) => key !== 'features');
      const current = typeof plan.feature_limits_json === 'string'
        ? JSON.parse(plan.feature_limits_json || '{}')
        : (plan.feature_limits_json || {});
      const suppliedFeatures = limits.features || {};
      if (
        numericEntries.some(([key, value]) =>
          !allowedLimits.has(key) || !Number.isInteger(Number(value)) || Number(value) < 0
        )
        || !suppliedFeatures || typeof suppliedFeatures !== 'object' || Array.isArray(suppliedFeatures)
        || Object.keys(suppliedFeatures).some(key =>
          !(key in DEFAULT_FEATURES) || typeof suppliedFeatures[key] !== 'boolean'
        )
      ) {
        await conn.rollback(); conn.release(); conn = null;
        return res.status(400).json({ error: 'Invalid plan limits or feature flags' });
      }
      sets.push('feature_limits_json=?');
      values.push(JSON.stringify({
        ...current,
        ...Object.fromEntries(numericEntries.map(([key, value]) => [key, Number(value)])),
        features: { ...(current.features || {}), ...suppliedFeatures },
      }));
    }
    if (!sets.length) { await conn.rollback(); conn.release(); conn = null; return res.status(400).json({ error: 'No changes supplied' }); }
    values.push(req.params.id);
    await conn.query(`UPDATE saas_plans SET ${sets.join(', ')} WHERE id=?`, values);
    await conn.commit(); conn.release(); conn = null;
    clearTenantContextCache();
    res.json({ ok: true });
  } catch (error) {
    if (conn) { await conn.rollback().catch(() => {}); conn.release(); }
    logger.error('[saas plan patch]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/saas/feature-flags?tenant_id=...  (global flags have tenant_id NULL)
router.get('/api/admin/saas/feature-flags', requireAuth, requirePlatformAdmin, async (req, res) => {
  try {
    const tid = req.query.tenant_id || null;
    const [rows] = await pool.query(
      'SELECT id, tenant_id, flag_key, is_enabled, config_json, updated_at FROM feature_flags WHERE tenant_id = ? OR tenant_id IS NULL ORDER BY flag_key',
      [tid]);
    res.json(rows);
  } catch (e) { logger.error('[saas]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/saas/feature-flags — upsert a flag { tenant_id?, flag_key, is_enabled, config }
router.post('/api/admin/saas/feature-flags', requireAuth, requirePlatformAdmin, async (req, res) => {
  let conn;
  let lockName;
  try {
    const flagKey = String(req.body.flag_key || '').trim();
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_FEATURES, flagKey)) {
      return res.status(400).json({ error: 'Unknown feature flag' });
    }
    const tenantId = req.body.tenant_id || null;
    const isEnabled = req.body.is_enabled ? 1 : 0;
    const config = req.body.config ?? null;
    if (config !== null && (!config || typeof config !== 'object' || Array.isArray(config))) {
      return res.status(400).json({ error: 'config must be an object' });
    }
    const configJson = config ? JSON.stringify(config) : null;
    if (configJson && configJson.length > 50000) return res.status(413).json({ error: 'Feature config is too large' });
    conn = await pool.getConnection();
    lockName = `feature-flag:${tenantId || 'global'}:${flagKey}`.slice(0, 64);
    const [[lock]] = await conn.query('SELECT GET_LOCK(?, 5) AS acquired', [lockName]);
    if (Number(lock?.acquired) !== 1) { conn.release(); conn = null; return res.status(503).json({ error: 'Feature flag is busy; retry' }); }
    await conn.beginTransaction();
    if (tenantId) {
      const [[tenant]] = await conn.query('SELECT id FROM tenants WHERE id=? LIMIT 1', [tenantId]);
      if (!tenant) { await conn.rollback(); await conn.query('SELECT RELEASE_LOCK(?)', [lockName]); conn.release(); conn = null; return res.status(404).json({ error: 'Tenant not found' }); }
    }
    const [[existing]] = await conn.query(
      `SELECT id FROM feature_flags
       WHERE flag_key=? AND ((tenant_id=?) OR (tenant_id IS NULL AND ? IS NULL))
       ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`,
      [flagKey, tenantId, tenantId]);
    if (existing) {
      await conn.query(
        `UPDATE feature_flags SET is_enabled=?, config_json=?
         WHERE id=? AND ((tenant_id=?) OR (tenant_id IS NULL AND ? IS NULL))`,
        [isEnabled, configJson, existing.id, tenantId, tenantId]);
    } else {
      await conn.query(
        `INSERT INTO feature_flags
           (id, tenant_id, scope_tenant_key, flag_key, is_enabled, config_json)
         VALUES (?,?,?,?,?,?)`,
        [uuidv4(), tenantId, tenantId || '__global__', flagKey, isEnabled, configJson]);
    }
    await conn.commit();
    await conn.query('SELECT RELEASE_LOCK(?)', [lockName]);
    conn.release(); conn = null;
    clearTenantContextCache(tenantId || undefined);
    res.json({ ok: true });
  } catch (e) {
    if (conn) {
      await conn.rollback().catch(() => {});
      if (lockName) await conn.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
      conn.release();
    }
    logger.error('[saas]', e.message); res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/saas/status — the current request's resolved tenant context
// (tenant + plan + effective feature set). Confirms the tenant plumbing end-to-end.
router.get('/api/admin/saas/status', requireAuth, requirePlatformAdmin, async (req, res) => {
  try {
    const ctx = await loadTenantContext(req.tenantId);
    res.json({ resolvedTenantId: req.tenantId || null, context: ctx });
  } catch (e) { logger.error('[saas]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
