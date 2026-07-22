'use strict';
const logger = require('../lib/logger');
const express = require('express');
const router = express.Router();

const { pool, cacheInvalidate } = require('../lib/db');
const { requireAuth, requireAdmin, requireAdminOrStaff } = require('../middleware/auth');
const { loadRoleOverrides } = require('../lib/rbacOverrides');
const { loadTemplates } = require('../lib/messageTemplates');
const { getTenantSetting, setTenantSetting } = require('../lib/tenantSettings');
const { invalidateFxCache } = require('../lib/finance');

// Settings (adminAiConfig, aiAgentConfig, messagingChannels, fbLeadAdsConfig)
router.get('/api/admin/settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await getTenantSetting('settings', { tenantId: req.tenantId, fallback: {} }));
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/api/admin/settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    await setTenantSetting('settings', req.body || {}, { tenantId: req.tenantId, actorId: req.user?.uid || req.user?.email });
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Email settings (sender, SMTP, template) — Admin → Settings → البريد ──────
const { getEmailConfig, invalidateEmailConfig } = require('../lib/email');

// GET current email config (password masked — never sent to the browser).
router.get('/api/admin/settings/email', requireAuth, requireAdmin, async (req, res) => {
  try {
    const c = await getEmailConfig(req.tenantId);
    res.json({ ...c, smtpPass: c.smtpPass ? '********' : '' });
  } catch (e) { logger.error('[email-settings]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// PUT email config. Merges into the saved blob; only overwrites the password when
// a real (non-masked, non-empty) value is supplied.
router.put('/api/admin/settings/email', requireAuth, requireAdmin, async (req, res) => {
  try {
    const allowed = ['smtpHost','smtpPort','smtpUser','smtpPass','senderName','senderAddress','brandColor','headerTitle','headerSubtitle','logoUrl','footerText'];
    const current = await getTenantSetting('email_config', { tenantId: req.tenantId, fallback: {} });
    const next = { ...current };
    for (const k of allowed) {
      if (req.body[k] === undefined) continue;
      if (k === 'smtpPass' && (!req.body[k] || req.body[k] === '********')) continue; // keep existing password
      next[k] = k === 'smtpPort' ? parseInt(req.body[k]) || 465 : req.body[k];
    }
    await setTenantSetting('email_config', next, { tenantId: req.tenantId, actorId: req.user?.uid || req.user?.email });
    invalidateEmailConfig(req.tenantId);
    res.json({ ok: true });
  } catch (e) { logger.error('[email-settings]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST send a test email to verify the configured SMTP end-to-end.
router.post('/api/admin/settings/email/test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const to = req.body?.to;
    if (!to) return res.status(400).json({ error: 'البريد المُستلِم مطلوب' });
    const { sendEmail: sendEmailBase } = require('../lib/email');
    const sendEmail = (toAddress, subject, html) => sendEmailBase(toAddress, subject, html, { tenantId: req.tenantId });
    await sendEmail(to, 'اختبار البريد — معهد الدراسات النفسية', '<p>لو وصلتك الرسالة دي يبقى إعدادات البريد شغّالة ✅</p>');
    res.json({ ok: true });
  } catch (e) { res.status(502).json({ error: 'فشل الإرسال: ' + e.message }); }
});

// ── Customer-journey (lifecycle) settings + activity ────────────────────────
const lifecycle = require('../lib/lifecycle');

router.get('/api/admin/settings/lifecycle', requireAuth, requireAdmin, async (req, res) => {
  try { res.json(await lifecycle.describe(req.tenantId)); }
  catch (e) { logger.error('[lifecycle-settings]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/api/admin/settings/lifecycle', requireAuth, requireAdmin, async (req, res) => {
  try {
    const enabled = req.body.enabled !== false;
    const steps = (req.body.steps && typeof req.body.steps === 'object') ? req.body.steps : {};
    await setTenantSetting('lifecycle', { enabled, steps }, { tenantId: req.tenantId, actorId: req.user?.uid || req.user?.email });
    lifecycle.invalidateConfig(req.tenantId);
    res.json({ ok: true });
  } catch (e) { logger.error('[lifecycle-settings]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Recent journey activity (outbox feed) — shows the automation is alive.
router.get('/api/admin/lifecycle/activity', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT channel, recipient, subject, status, attempts, created_at, sent_at
       FROM message_outbox WHERE tenant_id=? ORDER BY created_at DESC LIMIT 60`,
      [req.tenantId]
    ).catch(() => [[]]);
    const [[counts]] = await pool.query(
      `SELECT SUM(status='pending') AS pending, SUM(status='sent') AS sent, SUM(status IN ('failed','dead')) AS failed FROM message_outbox WHERE tenant_id=?`,
      [req.tenantId]
    ).catch(() => [[{ pending: 0, sent: 0, failed: 0 }]]);
    res.json({ counts, recent: rows });
  } catch (e) { logger.error('[lifecycle-activity]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Certificate Auto-Issue Settings
router.get('/api/admin/settings/certificate', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [progress, payment] = await Promise.all([
      getTenantSetting('cert_auto_threshold_progress', { tenantId: req.tenantId, fallback: 70 }),
      getTenantSetting('cert_auto_threshold_payment', { tenantId: req.tenantId, fallback: 90 }),
    ]);
    res.json({
      progress: Number(progress ?? 70),
      payment: Number(payment ?? 90),
    });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/api/admin/settings/certificate', requireAuth, requireAdmin, async (req, res) => {
  try {
    const p = Math.min(100, Math.max(0, parseFloat(req.body.progress) || 70));
    const pay = Math.min(100, Math.max(0, parseFloat(req.body.payment) || 90));
    await Promise.all([
      setTenantSetting('cert_auto_threshold_progress', p, { tenantId: req.tenantId, actorId: req.user?.uid || req.user?.email }),
      setTenantSetting('cert_auto_threshold_payment', pay, { tenantId: req.tenantId, actorId: req.user?.uid || req.user?.email }),
    ]);
    res.json({ ok: true, progress: p, payment: pay });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Site Content (key-value store)
router.get('/api/admin/content', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    res.json(await getTenantSetting('content', { tenantId: req.tenantId, fallback: {} }));
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
    const existing = await getTenantSetting('content', { tenantId: req.tenantId, fallback: {} });
    const existingKeys = Object.keys(existing).length;
    const incomingKeys = Object.keys(incoming).length;
    if (existingKeys > 5 && incomingKeys < Math.ceil(existingKeys * 0.6)) {
      logger.warn(`[content] PUT rejected: would shrink ${existingKeys}→${incomingKeys} keys (partial-wipe guard)`);
      return res.status(409).json({
        error: `Refused: PUT would drop ${existingKeys - incomingKeys} settings keys (${existingKeys}→${incomingKeys}). Send the full content object, or use PATCH for partial updates.`,
      });
    }

    await setTenantSetting('content', incoming, { tenantId: req.tenantId, actorId: req.user?.uid || req.user?.email });
    invalidateFxCache(req.tenantId);
    cacheInvalidate('site_content');
    loadRoleOverrides(req.tenantId).catch(() => {}); // re-sync backend RBAC enforcement immediately
    loadTemplates(req.tenantId).catch(() => {});     // re-sync editable message templates immediately
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/api/admin/content', requireAuth, requireAdmin, async (req, res) => {
  try {
    const existing = await getTenantSetting('content', { tenantId: req.tenantId, fallback: {} });
    const merged = { ...existing, ...req.body };
    await setTenantSetting('content', merged, { tenantId: req.tenantId, actorId: req.user?.uid || req.user?.email });
    invalidateFxCache(req.tenantId);
    cacheInvalidate('site_content');
    loadRoleOverrides(req.tenantId).catch(() => {}); // re-sync backend RBAC enforcement immediately
    loadTemplates(req.tenantId).catch(() => {});     // re-sync editable message templates immediately
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// FX Rates refresh
router.post('/api/admin/fx-rates/refresh', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const response = await fetch('https://open.er-api.com/v6/latest/EGP', { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return res.status(502).json({ error: 'Failed to fetch FX rates' });
    const data = await response.json();
    if (!data.rates || !data.rates.SAR || !data.rates.USD) {
      return res.status(502).json({ error: 'Invalid FX response' });
    }
    const sar_to_egp = parseFloat((1 / data.rates.SAR).toFixed(4));
    const usd_to_egp = parseFloat((1 / data.rates.USD).toFixed(4));
    const existing = await getTenantSetting('content', { tenantId: req.tenantId, fallback: {} });
    const merged = { ...existing, 'exchange.sar_to_egp': String(sar_to_egp), 'exchange.usd_to_egp': String(usd_to_egp) };
    await setTenantSetting('content', merged, { tenantId: req.tenantId, actorId: req.user?.uid || req.user?.email });
    invalidateFxCache(req.tenantId);
    cacheInvalidate('site_content');
    res.json({ ok: true, sar_to_egp, usd_to_egp, updatedAt: new Date().toISOString() });
  } catch (e) {
    logger.error('[fx-rates]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Discounts
router.get('/api/admin/discounts', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await getTenantSetting('discounts', { tenantId: req.tenantId, fallback: [] }));
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/api/admin/discounts', requireAuth, requireAdmin, async (req, res) => {
  try {
    await setTenantSetting('discounts', req.body || [], { tenantId: req.tenantId, actorId: req.user?.uid || req.user?.email });
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Notification Settings (site_config JSON blob, separate from system notifications table)
router.get('/api/admin/notification-settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await getTenantSetting('notifications', { tenantId: req.tenantId, fallback: [] }));
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/api/admin/notification-settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    await setTenantSetting('notifications', req.body || [], { tenantId: req.tenantId, actorId: req.user?.uid || req.user?.email });
    res.json({ ok: true });
  } catch (e) {
    logger.error('[route]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
