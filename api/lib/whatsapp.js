'use strict';
const logger = require('./logger');
// ── WhatsApp helper — supports two providers, chosen in the admin panel ────────
//   • 'meta'      → WhatsApp Cloud API (graph.facebook.com)  — token + phoneId
//   • 'green-api' → Green-API gateway                        — instanceId + apiToken
// All creds come from site_config.whatsapp_config (entered in the admin), with
// env vars as fallback so nothing has to be edited on the server.
const { getTenantSetting } = require('./tenantSettings');
const { DEFAULT_TENANT } = require('../middleware/tenantContext');
const { resolveSecret } = require('./secretResolver');

function envSecret(name) {
  try { return resolveSecret(name); } catch (_) { return ''; }
}

function providerCredentialState(cfg = {}) {
  return {
    metaReady: Boolean(cfg.metaToken || envSecret('WHATSAPP_TOKEN'))
      && Boolean(cfg.metaPhoneId || process.env.WHATSAPP_PHONE_ID),
    greenReady: Boolean(cfg.instanceId || process.env.WA_INSTANCE_ID)
      && Boolean(cfg.apiToken || envSecret('WA_API_TOKEN')),
  };
}

// Config cached in memory — refreshes every 5min. Avoids one DB query per notification.
const waCfgCache = new Map();
async function getWaCfg(tenantId = DEFAULT_TENANT) {
  const scopedTenant = String(tenantId || DEFAULT_TENANT);
  const now = Date.now();
  const hit = waCfgCache.get(scopedTenant);
  if (hit && now - hit.at < 5 * 60 * 1000) return hit.value;
  let value = {};
  try {
    value = await getTenantSetting('whatsapp_config', { tenantId: scopedTenant, fallback: {} }) || {};
  } catch (_) { value = hit?.value || {}; }
  waCfgCache.set(scopedTenant, { value, at: now });
  return value;
}

function invalidateWaCfg(tenantId) {
  if (tenantId) waCfgCache.delete(String(tenantId));
  else waCfgCache.clear();
}

// Resolve which provider to use: explicit config wins, else infer from whatever
// creds are present (config first, then env).
function resolveProvider(cfg) {
  if (cfg.provider === 'meta' || cfg.provider === 'green-api') return cfg.provider;
  if (cfg.metaToken || cfg.metaPhoneId) return 'meta';
  if (cfg.instanceId || cfg.apiToken) return 'green-api';
  if (providerCredentialState(cfg).metaReady) return 'meta';
  return 'green-api';
}

// Meta WhatsApp Cloud API — plain text. NOTE: outside the 24h customer-service
// window Meta only allows pre-approved TEMPLATE messages; free-form text there is
// rejected (handled as a normal API error). Matches the format the watchdog uses.
async function _sendMeta(normalized, message, cfg) {
  const token   = cfg.metaToken   || envSecret('WHATSAPP_TOKEN');
  const phoneId = cfg.metaPhoneId || process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) {
    logger.warn('[WhatsApp] Meta not configured — skipping notification');
    return { ok: false, provider: 'meta', reason: 'not_configured' };
  }
  const res = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: normalized, type: 'text', text: { body: message } }),
  });
  const data = await res.json();
  if (!res.ok) { logger.warn('[WhatsApp] Meta API error:', data); return { ok: false, provider: 'meta', reason: data }; }
  return { ok: true, provider: 'meta', idMessage: data.messages?.[0]?.id };
}

async function _sendGreenApi(normalized, message, cfg) {
  const instanceId = cfg.instanceId || process.env.WA_INSTANCE_ID;
  const apiToken   = cfg.apiToken   || envSecret('WA_API_TOKEN');
  if (!instanceId || !apiToken) {
    logger.warn('[WhatsApp] Green-API not configured — skipping notification');
    return { ok: false, provider: 'green-api', reason: 'not_configured' };
  }
  const chatId = normalized.includes('@') ? normalized : `${normalized}@c.us`;
  const url = `https://api.green-api.com/waInstance${instanceId}/sendMessage/${apiToken}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId, message }),
  });
  const data = await res.json();
  if (!res.ok) { logger.warn('[WhatsApp] Green-API error:', data); return { ok: false, provider: 'green-api', reason: data }; }
  return { ok: true, provider: 'green-api', idMessage: data.idMessage };
}

async function sendWhatsApp(phone, message, options = {}) {
  try {
    const tenantId = typeof options === 'string' ? options : options.tenantId;
    const cfg = await getWaCfg(tenantId || DEFAULT_TENANT);
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

module.exports = { getWaCfg, invalidateWaCfg, providerCredentialState, sendWhatsApp, resolveProvider };
