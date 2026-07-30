'use strict';
const logger = require('../../lib/logger');
const { isIP } = require('node:net');
const bcrypt   = require('../../lib/passwordHash');
const { uuidv4 } = require('../../lib/id');
const { pool } = require('../../lib/db');
const { mailer, sendEmail } = require('../../lib/email');
const { sendWhatsApp } = require('../../lib/whatsapp');
const {
  requireAuth, requireAdmin, requireSuperAdmin, requireAdminOrStaff,
  requirePermission, invalidateIdentity,
} = require('../../middleware/auth');
const { hasPermission, PERMISSIONS, ROLES } = require('../../constants/permissions');
const express = require('express');
const router = express.Router();
const { logLogin, sendDailyReport, scheduleDailyReport, pushAdminNotif, runFollowUpReminders, scheduleFollowUpReminders, runPaymentDueReminders, schedulePaymentReminders, getSysConfig, setSysConfig, SYS_DEFAULTS, KV_ALLOWED_KEYS } = require('./_shared');
const { isPlainJsonObject, preserveStoredSecrets, redactSecrets } = require('../../lib/configSecrets');
const { getTenantSetting, setTenantSetting } = require('../../lib/tenantSettings');
const { getMfaPolicy, saveMfaPolicy } = require('../../lib/mfaPolicy');
const { invalidateIpWhitelist } = require('../../middleware/ipWhitelist');

function validateConfigSection(section, value) {
  if (!Object.prototype.hasOwnProperty.call(SYS_DEFAULTS, section)) return `Unknown section: ${section}`;
  const defaultValue = SYS_DEFAULTS[section];
  if (Array.isArray(defaultValue)) {
    if (!Array.isArray(value)) return `${section} must be an array`;
    if (value.length > 1000) return `${section} exceeds the maximum allowed rows`;
    return null;
  }
  if (isPlainJsonObject(defaultValue)) {
    if (!isPlainJsonObject(value)) return `${section} must be an object`;
    if (JSON.stringify(value).length > 200000) return `${section} payload is too large`;
  }
  return null;
}

function sectionMeta(section) {
  const value = SYS_DEFAULTS[section];
  return {
    section,
    kind: Array.isArray(value) ? 'array' : typeof value,
    defaultRows: Array.isArray(value) ? value.length : undefined,
    keys: isPlainJsonObject(value) ? Object.keys(value) : undefined,
  };
}

function normalizeRequestIp(value) {
  return String(value || '').split(',')[0].trim().replace(/^::ffff:/, '');
}

function isValidIpOrCidr(value) {
  const [address, prefix, extra] = String(value || '').trim().split('/');
  if (extra !== undefined || isIP(address) !== 4) return false;
  if (prefix === undefined) return true;
  return /^\d{1,2}$/.test(prefix) && Number(prefix) >= 0 && Number(prefix) <= 32;
}

async function publishConfigEvent(req, section) {
  try {
    const { publishRealtimeEvent } = require('../../lib/realtime');
    await publishRealtimeEvent('system-config:updated', {
      section,
      actor: req.user?.email || req.user?.uid || 'admin',
      at: new Date().toISOString(),
    });
  } catch (_) {}
}

router.get('/api/admin/sys-config', requireAuth, requireAdminOrStaff, requirePermission('manage_settings'), async (req, res) => {
  try {
    const section = req.query.section;
    if (section) {
      const saved = await getSysConfig(section, req.tenantId);
      return res.json(redactSecrets(saved ?? SYS_DEFAULTS[section] ?? null));
    }
    // Return all sections
    const keys = Object.keys(SYS_DEFAULTS);
    const vals = await Promise.all(keys.map(k => getSysConfig(k, req.tenantId)));
    const result = {};
    keys.forEach((k, i) => { result[k] = vals[i] ?? SYS_DEFAULTS[k]; });
    res.json(redactSecrets(result));
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/api/admin/sys-config/meta', requireAuth, requireAdminOrStaff, requirePermission('manage_settings'), async (_req, res) => {
  try {
    res.json({
      sections: Object.keys(SYS_DEFAULTS).map(sectionMeta),
      publicSections: ['branches', 'currencies', 'countries', 'payment_methods', 'session_types', 'general'],
    });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PUT /api/admin/sys-config/:section — save a section
router.put('/api/admin/sys-config/:section', requireAuth, requireAdminOrStaff, requirePermission('manage_settings'), async (req, res) => {
  try {
    const { section } = req.params;
    const validationError = validateConfigSection(section, req.body);
    if (validationError) return res.status(400).json({ error: validationError });
    const stored = await getSysConfig(section, req.tenantId);
    const safeValue = preserveStoredSecrets(stored, req.body);
    await setSysConfig(section, safeValue, req.tenantId, req.user?.uid || req.user?.email);
    await publishConfigEvent(req, section);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/sys-config/:section/reset — reset section to defaults
router.post('/api/admin/sys-config/:section/reset', requireAuth, requireAdminOrStaff, requirePermission('manage_settings'), async (req, res) => {
  try {
    const { section } = req.params;
    if (!SYS_DEFAULTS[section]) return res.status(400).json({ error: 'Unknown section' });
    await setSysConfig(section, SYS_DEFAULTS[section], req.tenantId, req.user?.uid || req.user?.email);
    await publishConfigEvent(req, section);
    res.json({ ok: true, data: SYS_DEFAULTS[section] });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/sys-config/public — for client-side use (branches, currencies, etc.)
router.get('/api/admin/sys-config/public', async (req, res) => {
  try {
    const sections = ['branches', 'currencies', 'countries', 'payment_methods', 'session_types', 'general'];
    const values = await Promise.all(sections.map(k => getSysConfig(k, req.tenantId)));
    const result = {};
    sections.forEach((k, i) => { result[k] = values[i] ?? SYS_DEFAULTS[k]; });
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json(result);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Staff Account Password Management ────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/staff — list all staff. This list is loaded broadly across the admin
// app just for name lookups (assignee dropdowns etc.), so it stays open to any staff —
// but commission/salary/target fields are only included for roles with view_staff (this
// route had zero permission check at all, so e.g. a TRAINER could read every SALES rep's
// commission rate).
// POST /api/admin/staff/:id/set-password — admin sets password for staff member
router.post('/api/admin/staff/:id/set-password', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 8) return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' });
    const hash = await bcrypt.hash(password, 12);

    // Check if staff already has a login in users table
    const [[staff]] = await pool.query('SELECT id, email, name FROM staff WHERE id=? AND tenant_id=? LIMIT 1', [req.params.id, req.tenantId]);
    if (!staff) return res.status(404).json({ error: 'Staff not found' });

    // Upsert into users table (staff use email as username)
    await pool.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, role, name) VALUES (UUID(),?,?,?,'staff',?)
       ON DUPLICATE KEY UPDATE
         password_hash=VALUES(password_hash),
         session_version=session_version+1`,
      [req.tenantId, staff.email, hash, staff.name || staff.email]
    );
    invalidateIdentity(req.tenantId, '', staff.email);
    res.json({ ok: true, message: 'تم تعيين كلمة المرور بنجاح' });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/staff/:id/toggle-active — enable/disable staff login
router.post('/api/admin/staff/:id/toggle-active', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const [[staff]] = await pool.query('SELECT id, is_active, email FROM staff WHERE id=? AND tenant_id=? LIMIT 1', [req.params.id, req.tenantId]);
    if (!staff) return res.status(404).json({ error: 'Not found' });
    const newActive = staff.is_active ? 0 : 1;
    await pool.query('UPDATE staff SET is_active=? WHERE id=? AND tenant_id=?', [newActive, req.params.id, req.tenantId]);
    // Also update users table
    await pool.query(
      'UPDATE users SET is_active=?, session_version=session_version+1 WHERE tenant_id=? AND email=?',
      [newActive, req.tenantId, staff.email]
    );
    invalidateIdentity(req.tenantId, '', staff.email);
    // When deactivating: un-assign all leads and subscribers so they go to the pool
    if (!newActive) {
      await pool.query(
        'UPDATE leads SET assigned_sales_id=NULL, assigned_sales_name=NULL WHERE tenant_id=? AND assigned_sales_id=?',
        [req.tenantId, staff.id]
      ).catch(() => {});
      await pool.query(
        'UPDATE subscribers SET assigned_sales_id=NULL, assigned_sales_name=NULL WHERE tenant_id=? AND assigned_sales_id=?',
        [req.tenantId, staff.id]
      ).catch(() => {});
      await pool.query(
        'UPDATE subscribers SET assigned_cs_id=NULL, assigned_cs_name=NULL WHERE tenant_id=? AND assigned_cs_id=?',
        [req.tenantId, staff.id]
      ).catch(() => {});
      logger.info(`[staff] deactivated ${staff.id} — leads and subscribers unassigned`);
    }
    res.json({ ok: true, is_active: !!newActive });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: IP Whitelist ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════


router.get('/api/admin/ip-whitelist', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, ip, label, created_at FROM ip_whitelist WHERE tenant_id=? ORDER BY created_at DESC', [req.tenantId]);
    res.json({ whitelist: rows, currentIp: normalizeRequestIp(req.ip) });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/ip-whitelist', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { ip, label } = req.body;
    if (!ip) return res.status(400).json({ error: 'ip required' });
    if (!isValidIpOrCidr(ip)) {
      return res.status(400).json({ error: 'Invalid IP format' });
    }
    await pool.query(
      'INSERT INTO ip_whitelist (tenant_id, ip, label, added_by) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE label=VALUES(label)',
      [req.tenantId, ip.trim(), label || null, req.user?.uid || null]
    );
    const [[row]] = await pool.query('SELECT id, ip, label, created_at FROM ip_whitelist WHERE tenant_id=? AND ip=?', [req.tenantId, ip.trim()]);
    invalidateIpWhitelist(req.tenantId);
    res.json({ ok: true, entry: row });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/api/admin/ip-whitelist/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [r] = await pool.query('DELETE FROM ip_whitelist WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Entry not found' });
    invalidateIpWhitelist(req.tenantId);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.get(
  '/api/admin/security/mfa-policy',
  requireAuth, requireAdminOrStaff, requirePermission('view_security'),
  async (req, res) => {
    try {
      res.json(await getMfaPolicy(req.tenantId, { fresh: true }));
    } catch (error) {
      logger.error('[security/mfa-policy get]', error);
      res.status(500).json({ error: 'Failed to load MFA policy' });
    }
  }
);

router.put(
  '/api/admin/security/mfa-policy',
  requireAuth, requireAdminOrStaff, requirePermission('manage_security'),
  async (req, res) => {
    try {
      const roles = Array.isArray(req.body?.required_roles) ? req.body.required_roles : [];
      const permissions = Array.isArray(req.body?.required_permissions) ? req.body.required_permissions : [];
      const knownRoles = new Set(Object.values(ROLES));
      const knownPermissions = new Set(Object.values(PERMISSIONS));
      if (
        roles.length > 25 || permissions.length > 50
        || roles.some(role => !knownRoles.has(String(role).toLowerCase()))
        || permissions.some(permission => !knownPermissions.has(String(permission).toLowerCase()))
      ) {
        return res.status(400).json({ error: 'Invalid MFA policy roles or permissions' });
      }
      const policy = await saveMfaPolicy(req.tenantId, {
        enabled: req.body?.enabled === true,
        required_roles: roles,
        required_permissions: permissions,
      }, req.user?.uid || req.user?.email);
      await publishConfigEvent(req, 'security_mfa_policy');
      res.json({ ok: true, policy });
    } catch (error) {
      logger.error('[security/mfa-policy put]', error);
      res.status(500).json({ error: 'Failed to save MFA policy' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Generic Key-Value Store (for frontend tabs persistence) ───────
// ═══════════════════════════════════════════════════════════════════════════
// Allowed keys (whitelist to prevent abuse)

router.get('/api/admin/kv/:key', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    if (!KV_ALLOWED_KEYS.includes(key)) return res.status(400).json({ error: 'Unknown key' });
    const data = await getTenantSetting(`kv_${key}`, { tenantId: req.tenantId, fallback: null });
    res.json({ ok: true, key, data });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PUT /api/admin/kv/:key
router.put('/api/admin/kv/:key', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    if (!KV_ALLOWED_KEYS.includes(key)) return res.status(400).json({ error: 'Unknown key' });
    const value = req.body;
    await setTenantSetting(`kv_${key}`, value, { tenantId: req.tenantId, actorId: req.user?.uid || req.user?.email });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
