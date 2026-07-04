'use strict';
const logger = require('../../lib/logger');
const bcrypt   = require('bcryptjs');
const { uuidv4 } = require('../../lib/id');
const { pool } = require('../../lib/db');
const { mailer, sendEmail } = require('../../lib/email');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { requireAuth, requireAdmin, requireSuperAdmin, requireAdminOrStaff } = require('../../middleware/auth');
const express = require('express');
const router = express.Router();
const { logLogin, sendDailyReport, scheduleDailyReport, pushAdminNotif, runFollowUpReminders, scheduleFollowUpReminders, runPaymentDueReminders, schedulePaymentReminders, getSysConfig, setSysConfig, SYS_DEFAULTS, KV_ALLOWED_KEYS } = require('./_shared');

router.get('/api/admin/sys-config', requireAuth, requireAdmin, async (req, res) => {
  try {
    const section = req.query.section;
    if (section) {
      const saved = await getSysConfig(section);
      return res.json(saved ?? SYS_DEFAULTS[section] ?? null);
    }
    // Return all sections
    const keys = Object.keys(SYS_DEFAULTS);
    const vals = await Promise.all(keys.map(k => getSysConfig(k)));
    const result = {};
    keys.forEach((k, i) => { result[k] = vals[i] ?? SYS_DEFAULTS[k]; });
    res.json(result);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PUT /api/admin/sys-config/:section — save a section
router.put('/api/admin/sys-config/:section', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { section } = req.params;
    if (!Object.keys(SYS_DEFAULTS).includes(section)) return res.status(400).json({ error: 'Unknown section: ' + section });
    await setSysConfig(section, req.body);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/sys-config/:section/reset — reset section to defaults
router.post('/api/admin/sys-config/:section/reset', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { section } = req.params;
    if (!SYS_DEFAULTS[section]) return res.status(400).json({ error: 'Unknown section' });
    await setSysConfig(section, SYS_DEFAULTS[section]);
    res.json({ ok: true, data: SYS_DEFAULTS[section] });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/sys-config/public — for client-side use (branches, currencies, etc.)
router.get('/api/admin/sys-config/public', async (_req, res) => {
  try {
    const sections = ['branches', 'currencies', 'countries', 'payment_methods', 'session_types', 'general'];
    const values = await Promise.all(sections.map(k => getSysConfig(k)));
    const result = {};
    sections.forEach((k, i) => { result[k] = values[i] ?? SYS_DEFAULTS[k]; });
    res.json(result);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Staff Account Password Management ────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/admin/staff — list all staff
router.get('/api/admin/staff', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, email, phone, role, image, specialization, joined_at, is_active, notes, commission_rate, created_at,
              monthly_target AS monthlyTarget, monthly_target_type AS monthlyTargetType,
              monthly_leads_target AS monthlyLeadsTarget, monthly_bonus AS monthlyBonus
       FROM staff ORDER BY name ASC`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/staff/:id/set-password — admin sets password for staff member
router.post('/api/admin/staff/:id/set-password', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
    const hash = await bcrypt.hash(password, 10);

    // Check if staff already has a login in users table
    const [[staff]] = await pool.query('SELECT id, email FROM staff WHERE id=? LIMIT 1', [req.params.id]);
    if (!staff) return res.status(404).json({ error: 'Staff not found' });

    // Upsert into users table (staff use email as username)
    await pool.query(
      `INSERT INTO users (id, email, password_hash, role, name) VALUES (UUID(),?,?,'staff',?)
       ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash)`,
      [staff.email, hash, staff.name || staff.email]
    );
    res.json({ ok: true, message: 'تم تعيين كلمة المرور بنجاح' });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/staff/:id/toggle-active — enable/disable staff login
router.post('/api/admin/staff/:id/toggle-active', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const [[staff]] = await pool.query('SELECT id, is_active, email FROM staff WHERE id=? LIMIT 1', [req.params.id]);
    if (!staff) return res.status(404).json({ error: 'Not found' });
    const newActive = staff.is_active ? 0 : 1;
    await pool.query('UPDATE staff SET is_active=? WHERE id=?', [newActive, req.params.id]);
    // Also update users table
    await pool.query('UPDATE users SET is_active=? WHERE email=?', [newActive, staff.email]).catch(() => {});
    // When deactivating: un-assign all leads and subscribers so they go to the pool
    if (!newActive) {
      await pool.query(
        'UPDATE leads SET assigned_sales_id=NULL, assigned_sales_name=NULL WHERE assigned_sales_id=?',
        [staff.id]
      ).catch(() => {});
      await pool.query(
        'UPDATE subscribers SET assigned_sales_id=NULL, assigned_sales_name=NULL WHERE assigned_sales_id=?',
        [staff.id]
      ).catch(() => {});
      await pool.query(
        'UPDATE subscribers SET assigned_cs_id=NULL, assigned_cs_name=NULL WHERE assigned_cs_id=?',
        [staff.id]
      ).catch(() => {});
      logger.info(`[staff] deactivated ${staff.id} — leads and subscribers unassigned`);
    }
    res.json({ ok: true, is_active: !!newActive });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: IP Whitelist ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// Ensure ip_whitelist table
(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS ip_whitelist (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      ip VARCHAR(64) NOT NULL,
      label VARCHAR(255) DEFAULT NULL,
      added_by VARCHAR(36) DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_ip (ip)
    ) CHARACTER SET utf8mb4`);
  } catch (e) { logger.warn('[ip_whitelist table]', e.message); }
})();

router.get('/api/admin/ip-whitelist', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, ip, label, created_at FROM ip_whitelist ORDER BY created_at DESC');
    res.json({ whitelist: rows });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/ip-whitelist', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { ip, label } = req.body;
    if (!ip) return res.status(400).json({ error: 'ip required' });
    // Basic validation: IPv4 or CIDR
    if (!/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(ip.trim())) {
      return res.status(400).json({ error: 'Invalid IP format' });
    }
    await pool.query(
      'INSERT INTO ip_whitelist (ip, label, added_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE label=VALUES(label)',
      [ip.trim(), label || null, req.user?.uid || null]
    );
    const [[row]] = await pool.query('SELECT id, ip, label, created_at FROM ip_whitelist WHERE ip=?', [ip.trim()]);
    res.json({ ok: true, entry: row });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/api/admin/ip-whitelist/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM ip_whitelist WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Generic Key-Value Store (for frontend tabs persistence) ───────
// ═══════════════════════════════════════════════════════════════════════════
// Allowed keys (whitelist to prevent abuse)

router.get('/api/admin/kv/:key', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    if (!KV_ALLOWED_KEYS.includes(key)) return res.status(400).json({ error: 'Unknown key' });
    const [[row]] = await pool.query("SELECT `value` FROM site_config WHERE `key`=? LIMIT 1", [`kv_${key}`]);
    const data = row?.value ? JSON.parse(row.value) : null;
    res.json({ ok: true, key, data });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PUT /api/admin/kv/:key
router.put('/api/admin/kv/:key', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    if (!KV_ALLOWED_KEYS.includes(key)) return res.status(400).json({ error: 'Unknown key' });
    const value = req.body;
    await pool.query(
      "INSERT INTO site_config (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)",
      [`kv_${key}`, JSON.stringify(value)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
