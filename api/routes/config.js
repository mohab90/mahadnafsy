'use strict';
const logger = require('../lib/logger');
const express = require('express');
const router = express.Router();

const { pool, cacheInvalidate } = require('../lib/db');
const { requireAuth, requireAdmin, requireAdminOrStaff } = require('../middleware/auth');
const { loadRoleOverrides } = require('../lib/rbacOverrides');
const { loadTemplates } = require('../lib/messageTemplates');

// Settings (adminAiConfig, aiAgentConfig, messagingChannels, fbLeadAdsConfig)
router.get('/api/admin/settings', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT `value` FROM site_config WHERE `key` = 'settings'");
    const val = rows[0]?.value;
    res.json(val ? JSON.parse(val) : {});
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/api/admin/settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query(
      "INSERT INTO site_config (`key`, `value`) VALUES ('settings', ?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)",
      [JSON.stringify(req.body)]
    );
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Email settings (sender, SMTP, template) — Admin → Settings → البريد ──────
const { getEmailConfig, invalidateEmailConfig } = require('../lib/email');

// GET current email config (password masked — never sent to the browser).
router.get('/api/admin/settings/email', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const c = await getEmailConfig();
    res.json({ ...c, smtpPass: c.smtpPass ? '********' : '' });
  } catch (e) { logger.error('[email-settings]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// PUT email config. Merges into the saved blob; only overwrites the password when
// a real (non-masked, non-empty) value is supplied.
router.put('/api/admin/settings/email', requireAuth, requireAdmin, async (req, res) => {
  try {
    const allowed = ['smtpHost','smtpPort','smtpUser','smtpPass','senderName','senderAddress','brandColor','headerTitle','headerSubtitle','logoUrl','footerText'];
    const [rows] = await pool.query("SELECT `value` FROM site_config WHERE `key`='email_config' LIMIT 1");
    const current = rows[0]?.value ? (typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value) : {};
    const next = { ...current };
    for (const k of allowed) {
      if (req.body[k] === undefined) continue;
      if (k === 'smtpPass' && (!req.body[k] || req.body[k] === '********')) continue; // keep existing password
      next[k] = k === 'smtpPort' ? parseInt(req.body[k]) || 465 : req.body[k];
    }
    await pool.query(
      "INSERT INTO site_config (`key`,`value`) VALUES ('email_config', ?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)",
      [JSON.stringify(next)]
    );
    invalidateEmailConfig();
    res.json({ ok: true });
  } catch (e) { logger.error('[email-settings]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST send a test email to verify the configured SMTP end-to-end.
router.post('/api/admin/settings/email/test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const to = req.body?.to;
    if (!to) return res.status(400).json({ error: 'البريد المُستلِم مطلوب' });
    const { sendEmail } = require('../lib/email');
    await sendEmail(to, 'اختبار البريد — معهد الدراسات النفسية', '<p>لو وصلتك الرسالة دي يبقى إعدادات البريد شغّالة ✅</p>');
    res.json({ ok: true });
  } catch (e) { res.status(502).json({ error: 'فشل الإرسال: ' + e.message }); }
});

// Certificate Auto-Issue Settings
router.get('/api/admin/settings/certificate', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT `key`, value FROM site_config WHERE `key` IN ('cert_auto_threshold_progress','cert_auto_threshold_payment')"
    );
    const cfg = Object.fromEntries(rows.map(r => [r.key, parseFloat(r.value || '0')]));
    res.json({
      progress: cfg.cert_auto_threshold_progress ?? 70,
      payment: cfg.cert_auto_threshold_payment ?? 90,
    });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/api/admin/settings/certificate', requireAuth, requireAdmin, async (req, res) => {
  try {
    const p = Math.min(100, Math.max(0, parseFloat(req.body.progress) || 70));
    const pay = Math.min(100, Math.max(0, parseFloat(req.body.payment) || 90));
    await pool.query(
      "INSERT INTO site_config (`key`,value) VALUES ('cert_auto_threshold_progress',?) ON DUPLICATE KEY UPDATE value=?",
      [String(p), String(p)]);
    await pool.query(
      "INSERT INTO site_config (`key`,value) VALUES ('cert_auto_threshold_payment',?) ON DUPLICATE KEY UPDATE value=?",
      [String(pay), String(pay)]);
    res.json({ ok: true, progress: p, payment: pay });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Site Content (key-value store)
router.get('/api/admin/content', requireAuth, requireAdminOrStaff, async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT `value` FROM site_config WHERE `key` = 'content'");
    const val = rows[0]?.value;
    res.json(val ? JSON.parse(val) : {});
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/api/admin/content', requireAuth, requireAdmin, async (req, res) => {
  try {
    const incoming = req.body && typeof req.body === 'object' ? req.body : null;
    if (!incoming) return res.status(400).json({ error: 'Body must be the full content object' });

    // ── Anti-wipe guard ──────────────────────────────────────────────────────
    // PUT REPLACES the whole content blob. A caller that accidentally sends a
    // PARTIAL object would erase every other setting (branding, payments, RBAC,
    // templates...). Reject suspiciously-small payloads — callers should send the
    // full object (use PATCH for partial merges).
    const [rows] = await pool.query("SELECT `value` FROM site_config WHERE `key` = 'content'");
    const existing = rows[0]?.value ? JSON.parse(rows[0].value) : {};
    const existingKeys = Object.keys(existing).length;
    const incomingKeys = Object.keys(incoming).length;
    if (existingKeys > 5 && incomingKeys < Math.ceil(existingKeys * 0.6)) {
      logger.warn(`[content] PUT rejected: would shrink ${existingKeys}→${incomingKeys} keys (partial-wipe guard)`);
      return res.status(409).json({
        error: `Refused: PUT would drop ${existingKeys - incomingKeys} settings keys (${existingKeys}→${incomingKeys}). Send the full content object, or use PATCH for partial updates.`,
      });
    }

    await pool.query(
      "INSERT INTO site_config (`key`, `value`) VALUES ('content', ?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)",
      [JSON.stringify(incoming)]
    );
    cacheInvalidate('site_content');
    loadRoleOverrides().catch(() => {}); // re-sync backend RBAC enforcement immediately
    loadTemplates().catch(() => {});     // re-sync editable message templates immediately
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/api/admin/content', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT `value` FROM site_config WHERE `key` = 'content'");
    const existing = rows[0]?.value ? JSON.parse(rows[0].value) : {};
    const merged = { ...existing, ...req.body };
    await pool.query(
      "INSERT INTO site_config (`key`, `value`) VALUES ('content', ?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)",
      [JSON.stringify(merged)]
    );
    cacheInvalidate('site_content');
    loadRoleOverrides().catch(() => {}); // re-sync backend RBAC enforcement immediately
    loadTemplates().catch(() => {});     // re-sync editable message templates immediately
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// FX Rates refresh
router.post('/api/admin/fx-rates/refresh', requireAuth, requireAdminOrStaff, async (_req, res) => {
  try {
    const response = await fetch('https://open.er-api.com/v6/latest/EGP', { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return res.status(502).json({ error: 'Failed to fetch FX rates' });
    const data = await response.json();
    if (!data.rates || !data.rates.SAR || !data.rates.USD) {
      return res.status(502).json({ error: 'Invalid FX response' });
    }
    const sar_to_egp = parseFloat((1 / data.rates.SAR).toFixed(4));
    const usd_to_egp = parseFloat((1 / data.rates.USD).toFixed(4));
    const [rows] = await pool.query("SELECT `value` FROM site_config WHERE `key` = 'content'");
    const existing = rows[0]?.value ? JSON.parse(rows[0].value) : {};
    const merged = { ...existing, 'exchange.sar_to_egp': String(sar_to_egp), 'exchange.usd_to_egp': String(usd_to_egp) };
    await pool.query(
      "INSERT INTO site_config (`key`, `value`) VALUES ('content', ?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)",
      [JSON.stringify(merged)]
    );
    cacheInvalidate('site_content');
    res.json({ ok: true, sar_to_egp, usd_to_egp, updatedAt: new Date().toISOString() });
  } catch (e) {
    logger.error('[fx-rates]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Discounts
router.get('/api/admin/discounts', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT `value` FROM site_config WHERE `key` = 'discounts'");
    res.json(rows[0]?.value ? JSON.parse(rows[0].value) : []);
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/api/admin/discounts', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query(
      "INSERT INTO site_config (`key`, `value`) VALUES ('discounts', ?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)",
      [JSON.stringify(req.body)]
    );
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Notification Settings (site_config JSON blob, separate from system notifications table)
router.get('/api/admin/notification-settings', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT `value` FROM site_config WHERE `key` = 'notifications'");
    res.json(rows[0]?.value ? JSON.parse(rows[0].value) : []);
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/api/admin/notification-settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pool.query(
      "INSERT INTO site_config (`key`, `value`) VALUES ('notifications', ?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)",
      [JSON.stringify(req.body)]
    );
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
