'use strict';
const logger = require('./logger');
// ── WhatsApp helper — supports two providers, chosen in the admin panel ────────
//   • 'meta'      → WhatsApp Cloud API (graph.facebook.com)  — token + phoneId
//   • 'green-api' → Green-API gateway                        — instanceId + apiToken
// All creds come from site_config.whatsapp_config (entered in the admin), with
// env vars as fallback so nothing has to be edited on the server.
const { pool } = require('./db');

// Config cached in memory — refreshes every 5min. Avoids one DB query per notification.
let _waCfgCache = null;
let _waCfgCacheTs = 0;
async function getWaCfg() {
  const now = Date.now();
  if (_waCfgCache && now - _waCfgCacheTs < 5 * 60 * 1000) return _waCfgCache;
  try {
    const [rows] = await pool.query("SELECT `value` FROM site_config WHERE `key` = 'whatsapp_config'");
    _waCfgCache = rows[0]?.value ? JSON.parse(rows[0].value) : {};
    _waCfgCacheTs = now;
  } catch (_) { _waCfgCache = _waCfgCache || {}; }
  return _waCfgCache;
}

// Resolve which provider to use: explicit config wins, else infer from whatever
// creds are present (config first, then env).
function resolveProvider(cfg) {
  if (cfg.provider === 'meta' || cfg.provider === 'green-api') return cfg.provider;
  if (cfg.metaToken || cfg.metaPhoneId) return 'meta';
  if (cfg.instanceId || cfg.apiToken) return 'green-api';
  if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID) return 'meta';
  return 'green-api';
}

// Meta WhatsApp Cloud API — plain text. NOTE: outside the 24h customer-service
// window Meta only allows pre-approved TEMPLATE messages; free-form text there is
// rejected (handled as a normal API error). Matches the format the watchdog uses.
async function _sendMeta(normalized, message, cfg) {
  const token   = cfg.metaToken   || process.env.WHATSAPP_TOKEN;
  const phoneId = cfg.metaPhoneId || process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) {
    logger.warn('[WhatsApp] Meta not configured — skipping notification');
    return { ok: false, reason: 'not_configured' };
  }
  const res = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: normalized, type: 'text', text: { body: message } }),
  });
  const data = await res.json();
  if (!res.ok) { logger.warn('[WhatsApp] Meta API error:', data); return { ok: false, reason: data }; }
  return { ok: true, idMessage: data.messages?.[0]?.id };
}

async function _sendGreenApi(normalized, message, cfg) {
  const instanceId = cfg.instanceId || process.env.WA_INSTANCE_ID;
  const apiToken   = cfg.apiToken   || process.env.WA_API_TOKEN;
  if (!instanceId || !apiToken) {
    logger.warn('[WhatsApp] Green-API not configured — skipping notification');
    return { ok: false, reason: 'not_configured' };
  }
  const chatId = normalized.includes('@') ? normalized : `${normalized}@c.us`;
  const url = `https://api.green-api.com/waInstance${instanceId}/sendMessage/${apiToken}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId, message }),
  });
  const data = await res.json();
  if (!res.ok) { logger.warn('[WhatsApp] Green-API error:', data); return { ok: false, reason: data }; }
  return { ok: true, idMessage: data.idMessage };
}

async function sendWhatsApp(phone, message) {
  try {
    const cfg = await getWaCfg();
    const normalized = phone.replace(/\D/g, '').replace(/^0+/, '');
    const provider = resolveProvider(cfg);
    return provider === 'meta'
      ? await _sendMeta(normalized, message, cfg)
      : await _sendGreenApi(normalized, message, cfg);
  } catch (e) {
    logger.warn('[WhatsApp] sendWhatsApp error:', e.message);
    return { ok: false, reason: e.message };
  }
}

module.exports = { getWaCfg, sendWhatsApp, resolveProvider };
