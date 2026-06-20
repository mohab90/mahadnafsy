'use strict';
const logger = require('./logger');
// ── WhatsApp helper (Green-API) ───────────────────────────────────────────────
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

async function sendWhatsApp(phone, message) {
  try {
    const cfg = await getWaCfg();
    const instanceId = cfg.instanceId || process.env.WA_INSTANCE_ID;
    const apiToken   = cfg.apiToken   || process.env.WA_API_TOKEN;
    if (!instanceId || !apiToken) {
      logger.warn('[WhatsApp] No credentials configured — skipping notification');
      return { ok: false, reason: 'not_configured' };
    }
    const normalized = phone.replace(/\D/g, '').replace(/^0+/, '');
    const chatId = normalized.includes('@') ? normalized : `${normalized}@c.us`;
    const url = `https://api.green-api.com/waInstance${instanceId}/sendMessage/${apiToken}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, message }),
    });
    const data = await res.json();
    if (!res.ok) {
      logger.warn('[WhatsApp] API error:', data);
      return { ok: false, reason: data };
    }
    return { ok: true, idMessage: data.idMessage };
  } catch (e) {
    logger.warn('[WhatsApp] sendWhatsApp error:', e.message);
    return { ok: false, reason: e.message };
  }
}

module.exports = { getWaCfg, sendWhatsApp };
