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
const { toDialable } = require('./phoneNumber');

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

/**
 * Send a WhatsApp message.
 *
 * @param {string} phone     any spelling — the address is rebuilt here
 * @param {string} message
 * @param {object|string} options
 *   tenantId   — required in practice; a bare string is accepted for the older
 *                call style used across the routes
 *   channelId  — send from this exact identity
 *   staffId    — send from this employee's own WhatsApp if they have one
 *
 * With neither channelId nor staffId this behaves exactly as it did before: the
 * tenant's default channel, or the legacy site_config credentials when no
 * channel rows exist yet.
 */
async function sendWhatsApp(phone, message, options = {}) {
  try {
    const opts = typeof options === 'string' ? { tenantId: options } : (options || {});
    const tenantId = opts.tenantId || DEFAULT_TENANT;

    // The delivery address must carry the country code. This used to be
    // `phone.replace(/\D/g,'').replace(/^0+/,'')`, which turns the way every
    // Egyptian customer writes their number — 01012345678 — into 1012345678, a
    // number that exists nowhere. The provider rejected it, the rejection was
    // logged at warn and swallowed, and the message simply never arrived.
    const normalized = toDialable(phone);
    if (!normalized) {
      logger.warn('[WhatsApp] refusing to send: number is not dialable', { phone: String(phone || '').slice(0, 4) + '…' });
      return { ok: false, reason: 'invalid_number' };
    }

    // A registered channel wins. Loaded lazily so this module stays usable in
    // tests and scripts that never touch the channel registry.
    const channels = require('./messagingChannels');
    const resolved = await channels.getSendableChannel({
      tenantId, channelId: opts.channelId || null, staffId: opts.staffId || null, kind: 'whatsapp',
    }).catch(error => {
      // Before migration 184 runs, the table does not exist. Falling back to the
      // legacy config is what keeps this deployable ahead of the migration.
      logger.debug?.('[WhatsApp] channel lookup unavailable, using legacy config', error.message);
      return null;
    });

    if (resolved) {
      // Budget is claimed before the send, not after: a personal number that
      // burns through its allowance gets the employee banned by the provider,
      // and a crash mid-send must not give the allowance back.
      const withinBudget = await channels.claimSendBudget(tenantId, resolved.row.id).catch(() => true);
      if (!withinBudget) {
        logger.warn('[WhatsApp] channel is out of daily budget', { channelId: resolved.row.id });
        return { ok: false, reason: 'daily_limit_reached', channelId: resolved.row.id };
      }
      const result = resolved.row.provider === 'meta'
        ? await _sendMeta(normalized, message, resolved.credentials)
        : await _sendGreenApi(normalized, message, resolved.credentials);
      // A send is the only honest proof the credentials work, so the channel's
      // status follows the result rather than whatever it was set at save time.
      if (result.ok) await channels.markChannelConnected(tenantId, resolved.row.id).catch(() => {});
      else if (result.reason !== 'not_configured') {
        await channels.markChannelError(tenantId, resolved.row.id, describeReason(result.reason)).catch(() => {});
      }
      return { ...result, channelId: resolved.row.id };
    }

    const cfg = await getWaCfg(tenantId);
    const provider = resolveProvider(cfg);
    return provider === 'meta'
      ? await _sendMeta(normalized, message, cfg)
      : await _sendGreenApi(normalized, message, cfg);
  } catch (e) {
    logger.warn('[WhatsApp] sendWhatsApp error:', e.message);
    return { ok: false, reason: e.message };
  }
}

/** Provider errors arrive as objects; store something a human can act on. */
function describeReason(reason) {
  if (!reason) return 'فشل الإرسال';
  if (typeof reason === 'string') return reason;
  return reason?.error?.message || reason?.message || JSON.stringify(reason).slice(0, 400);
}

module.exports = { getWaCfg, invalidateWaCfg, providerCredentialState, sendWhatsApp, resolveProvider };
