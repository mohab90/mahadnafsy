'use strict';
const logger = require('../../lib/logger');
const { uuidv4 } = require('../../lib/id');
const { pool } = require('../../lib/db');
const { mailer, sendEmail } = require('../../lib/email');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { requireAuth, requireAdmin, requireSuperAdmin, requireAdminOrStaff } = require('../../middleware/auth');
const { bulkOperationLimiter } = require('../../middleware/rateLimits');
const express = require('express');
const router = express.Router();
const { logLogin, sendDailyReport, scheduleDailyReport, pushAdminNotif, runFollowUpReminders, scheduleFollowUpReminders, runPaymentDueReminders, schedulePaymentReminders, getSysConfig, setSysConfig, SYS_DEFAULTS, KV_ALLOWED_KEYS } = require('./_shared');

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: SMS Integration (via WhatsApp fallback / Vonage / InfoBip) ───
// ═══════════════════════════════════════════════════════════════════════════


// GET /api/admin/sms-settings
router.get('/api/admin/sms-settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, provider, sender_id, is_active, updated_at FROM sms_settings WHERE tenant_id=? LIMIT 1', [req.tenantId]);
    res.json(rows[0] || { provider: 'vonage', sender_id: 'MAHAD', is_active: 0 });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// PUT /api/admin/sms-settings
router.put('/api/admin/sms-settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { provider, api_key, api_secret, sender_id, is_active } = req.body;
    const [exist] = await pool.query('SELECT id FROM sms_settings WHERE tenant_id=? LIMIT 1', [req.tenantId]);
    if (exist.length > 0) {
      await pool.query('UPDATE sms_settings SET provider=?, api_key=?, api_secret=?, sender_id=?, is_active=? WHERE id=? AND tenant_id=?',
        [provider, api_key, api_secret, sender_id, is_active ? 1 : 0, exist[0].id, req.tenantId]);
    } else {
      await pool.query('INSERT INTO sms_settings (tenant_id, provider, api_key, api_secret, sender_id, is_active) VALUES (?,?,?,?,?,?)',
        [req.tenantId, provider, api_key, api_secret, sender_id, is_active ? 1 : 0]);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/sms/send  — send single SMS
router.post('/api/admin/sms/send', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { to, message } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'to and message required' });

    const [rows] = await pool.query(
      'SELECT id, provider, api_key, api_secret, sender_id, is_active, updated_at FROM sms_settings WHERE tenant_id=? AND is_active=1 LIMIT 1',
      [req.tenantId]
    );
    if (!rows.length) return res.status(400).json({ error: 'SMS not configured' });
    const cfg = rows[0];

    let result;
    if (cfg.provider === 'vonage') {
      const fetch = (...a) => import('node-fetch').then(m => m.default(...a)).catch(() => null);
      if (!fetch) return res.status(500).json({ error: 'node-fetch not available' });
      const r = await fetch('https://rest.nexmo.com/sms/json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: cfg.api_key, api_secret: cfg.api_secret, to, from: cfg.sender_id, text: message }),
      });
      result = await r.json();
    } else if (cfg.provider === 'infobip') {
      const https = require('https');
      result = await new Promise((resolve) => {
        const body = JSON.stringify({ messages: [{ destinations: [{ to }], from: cfg.sender_id, text: message }] });
        const u = new URL(`https://api.infobip.com/sms/2/text/advanced`);
        const opts = { hostname: u.hostname, path: u.pathname, method: 'POST',
          headers: { 'Authorization': `App ${cfg.api_key}`, 'Content-Type': 'application/json', 'Accept': 'application/json' } };
        // Collect the bytes and decode once: `d += c` decodes each chunk on its
        // own, so a multi-byte character split across a chunk boundary is lost.
        // The parse is guarded because it runs inside an event handler, where a
        // throw escapes the promise entirely rather than rejecting it.
        const req2 = https.request(opts, r2 => {
          const parts = [];
          r2.on('data', c => parts.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
          r2.on('end', () => {
            const text = Buffer.concat(parts).toString('utf8');
            try {
              resolve(JSON.parse(text));
            } catch (parseError) {
              resolve({ error: `invalid provider response: ${parseError.message}` });
            }
          });
        });
        req2.on('error', e => resolve({ error: e.message }));
        req2.write(body); req2.end();
      });
    } else {
      return res.status(400).json({ error: 'Unknown provider' });
    }

    // Log to activity
    await pool.query(
      `INSERT INTO activity_logs
         (id, tenant_id, action, entity, entity_id, label, actor, at)
       VALUES (UUID(),?,'sms_sent','messaging',NULL,?,?,NOW())`,
      [req.tenantId, `SMS sent via ${cfg.provider}`, req.user?.email || req.user?.uid || 'admin']
    ).catch(() => {});

    res.json({ ok: true, result });
  } catch (e) { logger.error(e); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/sms/bulk  — bulk SMS to subscribers or leads
router.post('/api/admin/sms/bulk', requireAuth, requireAdmin, bulkOperationLimiter, async (req, res) => {
  try {
    const { audience, message, filter } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });

    let phones = [];
    if (audience === 'subscribers') {
      // subscribers has no `status` column — is_active carries the state, the
      // same confusion that used to make the churn report answer 500. Asking for
      // status here threw, so a filtered send to subscribers never went out and
      // the caller saw a server error instead of a reason.
      const wanted = String(filter?.status || '').toLowerCase();
      if (wanted && !['active', 'inactive'].includes(wanted)) {
        return res.status(400).json({
          error: 'فلتر الحالة للمشتركين يقبل active أو inactive فقط',
          code: 'UNSUPPORTED_SUBSCRIBER_STATUS',
        });
      }
      const [rows] = await pool.query(
        `SELECT phone FROM subscribers
          WHERE tenant_id=? AND phone IS NOT NULL AND phone != '' AND deleted_at IS NULL
                ${wanted ? 'AND is_active=?' : ''} LIMIT 5000`,
        wanted ? [req.tenantId, wanted === 'active' ? 1 : 0] : [req.tenantId]);
      phones = rows.map(r => r.phone);
    } else if (audience === 'leads') {
      const [rows] = await pool.query(`SELECT phone FROM leads WHERE tenant_id=? AND phone IS NOT NULL AND phone != '' ${filter?.status ? 'AND status=?' : ''} LIMIT 5000`,
        filter?.status ? [req.tenantId, filter.status] : [req.tenantId]);
      phones = rows.map(r => r.phone);
    } else if (Array.isArray(req.body.phones)) {
      phones = req.body.phones;
    }

    if (!phones.length) return res.status(400).json({ error: 'No recipients found' });

    // Queue — send in background, return count immediately
    res.json({ ok: true, queued: phones.length });

    // Background send
    const tenantId = req.tenantId;
    setImmediate(async () => {
      const [rows] = await pool.query(
        'SELECT id, provider, api_key, api_secret, sender_id, is_active, updated_at FROM sms_settings WHERE tenant_id=? AND is_active=1 LIMIT 1',
        [tenantId]
      ).catch(() => [[]]);
      if (!rows.length) return;
      const cfg = rows[0];
      for (const phone of phones) {
        try {
          await new Promise(r => setTimeout(r, 200)); // throttle
          if (cfg.provider === 'vonage') {
            const https = require('https');
            const body = JSON.stringify({ api_key: cfg.api_key, api_secret: cfg.api_secret, to: phone, from: cfg.sender_id, text: message });
            await new Promise(resolve => {
              const req2 = https.request({ hostname: 'rest.nexmo.com', path: '/sms/json', method: 'POST',
                headers: { 'Content-Type': 'application/json' } }, r2 => { r2.resume(); resolve(); });
              req2.on('error', resolve); req2.write(body); req2.end();
            });
          }
        } catch (_) {}
      }
    });
  } catch (e) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Subscription Billing Scheduler ───────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════


// GET /api/admin/subscription-plans
module.exports = router;
