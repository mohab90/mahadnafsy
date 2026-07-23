'use strict';

const express = require('express');
const router = express.Router();

const logger = require('../lib/logger').child({ module: 'communication-admin-route' });
const { pool } = require('../lib/db');
const { uuidv4 } = require('../lib/id');
const { getWaCfg, invalidateWaCfg, sendWhatsApp } = require('../lib/whatsapp');
const { branchIdForBranch, defaultDigitalBranch } = require('../lib/branches');
const { getFbLeadConfig } = require('../lib/facebookLeadAds');
const { DEFAULT_TENANT_ID, resolveTenantId } = require('../lib/tenantScope');
const { setTenantSetting } = require('../lib/tenantSettings');
const { redactSecrets } = require('../lib/configSecrets');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { whatsappSendLimiter, bulkOperationLimiter } = require('../middleware/rateLimits');

function routeError(res, error, message = 'communication admin route failed') {
  logger.error(message, error);
  return res.status(500).json({ error: 'Internal server error' });
}

function scopedTenantId(req) {
  return req.tenantId || resolveTenantId(req) || DEFAULT_TENANT_ID;
}

router.get('/api/admin/whatsapp-config', requireAuth, requireAdmin, async (req, res) => {
  try {
    const cfg = await getWaCfg(scopedTenantId(req));
    // Never return the token to frontend
    res.json({ instanceId: cfg.instanceId || '', hasToken: !!(cfg.apiToken) });
  } catch (e) { routeError(res, e); }
});

// GET /api/admin/facebook-lead-ads-config
router.get('/api/admin/facebook-lead-ads-config', requireAuth, requireAdmin, async (req, res) => {
  try {
    const cfg = await getFbLeadConfig(scopedTenantId(req));
    // redactSecrets() strips appSecret/verifyToken (not editable via this UI —
    // never round-tripped back on save) fully; pageAccessToken keeps its own
    // masked-placeholder convention since the save flow depends on it to
    // detect "unchanged" vs "user typed a new token".
    res.json({ ...redactSecrets(cfg), pageAccessToken: cfg.pageAccessToken ? '••••••••' : '', hasToken: !!(cfg.pageAccessToken) });
  } catch (e) { routeError(res, e); }
});

// PUT /api/admin/facebook-lead-ads-config
router.put('/api/admin/facebook-lead-ads-config', requireAuth, requireAdmin, async (req, res) => {
  try {
    const incoming = req.body;
    // Merge with existing (don't overwrite token if masked placeholder sent)
    const existing = await getFbLeadConfig(scopedTenantId(req));
    const pageAccessToken = (incoming.pageAccessToken && !incoming.pageAccessToken.startsWith('•'))
      ? incoming.pageAccessToken.trim()
      : existing.pageAccessToken;
    const merged = { ...existing, ...incoming, pageAccessToken, updatedAt: new Date().toISOString() };
    await setTenantSetting('facebook_lead_ads', merged, {
      tenantId: scopedTenantId(req),
      actorId: req.user?.uid || req.user?.email,
    });
    res.json({ ok: true });
  } catch (e) { routeError(res, e); }
});

// PUT /api/admin/whatsapp-config
router.put('/api/admin/whatsapp-config', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { instanceId, apiToken } = req.body;
    if (!instanceId || !apiToken) return res.status(400).json({ error: 'instanceId and apiToken required' });
    const tenantId = scopedTenantId(req);
    await setTenantSetting('whatsapp_config', { instanceId: instanceId.trim(), apiToken: apiToken.trim() }, {
      tenantId, actorId: req.user?.uid || req.user?.email,
    });
    invalidateWaCfg(tenantId);
    res.json({ ok: true });
  } catch (e) { routeError(res, e); }
});

// POST /api/admin/whatsapp-send  — send a single WhatsApp (admin manual send)
router.post('/api/admin/whatsapp-send', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) return res.status(400).json({ error: 'phone and message required' });
    const result = await sendWhatsApp(phone, message, { tenantId: scopedTenantId(req) });
    if (!result.ok) return res.status(400).json({ error: 'WhatsApp send failed', detail: result.reason });
    res.json({ ok: true });
  } catch (e) { routeError(res, e); }
});

// POST /api/admin/whatsapp-bulk  — send WhatsApp to multiple leads/subscribers
router.post('/api/admin/whatsapp-bulk', requireAuth, requireAdmin, bulkOperationLimiter, async (req, res) => {
  try {
    const { phones, message } = req.body;
    if (!Array.isArray(phones) || phones.length === 0) return res.status(400).json({ error: 'phones array required' });
    if (!message) return res.status(400).json({ error: 'message required' });
    if (phones.length > 200) return res.status(400).json({ error: 'Max 200 recipients per call' });

    const results = { sent: 0, failed: 0, errors: [] };
    for (const phone of phones) {
      // Small delay between each send to avoid API throttling
      await new Promise(r => setTimeout(r, 300));
      const r = await sendWhatsApp(phone, message, { tenantId: scopedTenantId(req) });
      if (r.ok) results.sent++;
      else { results.failed++; results.errors.push({ phone, reason: String(r.reason) }); }
    }
    res.json({ ok: true, ...results });
  } catch (e) { routeError(res, e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// CSV / EXCEL BULK LEAD IMPORT
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/leads/import  — body: { leads: [{name,phone,email,source,notes},...] }
// Frontend parses the CSV/Excel then sends the parsed rows as JSON (no multer needed)
router.post('/api/admin/leads/import', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { leads } = req.body;
    if (!Array.isArray(leads) || leads.length === 0) return res.status(400).json({ error: 'leads array required' });
    if (leads.length > 500) return res.status(400).json({ error: 'Max 500 leads per import' });

    // Pre-filter invalid rows
    const valid = [], errors = [];
    for (const l of leads) {
      if (!l.name || !l.phone) { errors.push(`سطر مفقود الاسم أو الهاتف: ${JSON.stringify(l)}`); continue; }
      valid.push({ ...l, phone: String(l.phone).trim() });
    }

    let imported = 0, skipped = 0;
    if (valid.length > 0) {
      const tenantId = scopedTenantId(req);
      const phones = valid.map(l => l.phone);
      const ph = phones.map(() => '?').join(',');
      // Batch-check existing phones in one query each
      const [subRows] = await pool.query(`SELECT phone FROM subscribers WHERE phone IN (${ph}) AND tenant_id=?`, [...phones, tenantId]);
      const [leadRows] = await pool.query(`SELECT phone FROM leads WHERE phone IN (${ph}) AND hidden=0 AND tenant_id=?`, [...phones, tenantId]);
      const existPhones = new Set([...subRows.map(r => r.phone), ...leadRows.map(r => r.phone)]);

      const insertRows = [], insertParams = [];
      for (const l of valid) {
        if (existPhones.has(l.phone)) {
          skipped++;
          errors.push(`${l.phone} موجود بالفعل`);
          continue;
        }
        const importBranch = defaultDigitalBranch(l.branch);
        insertRows.push('(?,?,?,?,?,?,?,?,?,?,?)');
        insertParams.push(
          uuidv4(), tenantId, String(l.name).trim(), l.email?.trim() || null, l.phone,
          l.source?.trim() || 'استيراد CSV', l.status || 'new',
          l.notes?.trim() || null, JSON.stringify({ branch: importBranch }), importBranch, branchIdForBranch(importBranch)
        );
        imported++;
      }
      if (insertRows.length > 0) {
        await pool.query(
          `INSERT IGNORE INTO leads (id, tenant_id, name, email, phone, source, status, notes, crm_json, branch, branch_id) VALUES ${insertRows.join(',')}`,
          insertParams
        );
      }
    }
    res.json({ ok: true, imported, skipped, errors: errors.slice(0, 20) });
  } catch (e) { routeError(res, e); }
});

// POST /api/admin/whatsapp-proxy/chats — list chats for a specific WA instance
router.post('/api/admin/whatsapp-proxy/chats', requireAuth, requireAdmin, async (req, res) => {
  const { instanceId, apiToken } = req.body;
  if (!instanceId || !apiToken) return res.status(400).json({ error: 'missing instanceId or apiToken' });
  // SSRF guard: instanceId must be digits only; apiToken alphanumeric+hyphens only
  if (!/^\d{1,20}$/.test(String(instanceId))) return res.status(400).json({ error: 'invalid instanceId' });
  if (!/^[A-Za-z0-9_\-]{10,80}$/.test(String(apiToken))) return res.status(400).json({ error: 'invalid apiToken' });
  try {
    const r = await fetch(`https://api.green-api.com/waInstance${instanceId}/getChats/${apiToken}`);
    const data = await r.json();
    res.json(data);
  } catch (e) { routeError(res, e); }
});

// POST /api/admin/whatsapp-proxy/history — chat message history for a specific instance
router.post('/api/admin/whatsapp-proxy/history', requireAuth, requireAdmin, async (req, res) => {
  const { instanceId, apiToken, chatId, count = 30 } = req.body;
  if (!instanceId || !apiToken || !chatId) return res.status(400).json({ error: 'missing params' });
  // SSRF guard: instanceId must be digits only; apiToken alphanumeric+hyphens only
  if (!/^\d{1,20}$/.test(String(instanceId))) return res.status(400).json({ error: 'invalid instanceId' });
  if (!/^[A-Za-z0-9_\-]{10,80}$/.test(String(apiToken))) return res.status(400).json({ error: 'invalid apiToken' });
  try {
    const r = await fetch(`https://api.green-api.com/waInstance${instanceId}/getChatHistory/${apiToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, count: Math.min(Number(count), 100) }),
    });
    const data = await r.json();
    res.json(data);
  } catch (e) { routeError(res, e); }
});

// POST /api/admin/whatsapp-proxy/send — send msg via a specific rep's WA instance
router.post('/api/admin/whatsapp-proxy/send', requireAuth, requireAdmin, whatsappSendLimiter, async (req, res) => {
  const { instanceId, apiToken, phone, message } = req.body;
  if (!instanceId || !apiToken || !phone || !message) return res.status(400).json({ error: 'missing params' });
  // SSRF guard: instanceId must be digits only; apiToken alphanumeric+hyphens only
  if (!/^\d{1,20}$/.test(String(instanceId))) return res.status(400).json({ error: 'invalid instanceId' });
  if (!/^[A-Za-z0-9_\-]{10,80}$/.test(String(apiToken))) return res.status(400).json({ error: 'invalid apiToken' });
  const normalized = String(phone).replace(/\D/g, '').replace(/^0/, '20');
  const chatId = normalized + '@c.us';
  try {
    const r = await fetch(`https://api.green-api.com/waInstance${instanceId}/sendMessage/${apiToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, message: String(message).slice(0, 4096) }),
    });
    const data = await r.json();
    if (data.idMessage) res.json({ ok: true, idMessage: data.idMessage });
    else res.status(400).json({ ok: false, reason: JSON.stringify(data) });
  } catch (e) { routeError(res, e); }
});

module.exports = router;
