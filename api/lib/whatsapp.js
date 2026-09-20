'use strict';
const logger = require('./logger');
// ── WhatsApp helper ───────────────────────────────────────────────────────────
// Two ways to send, and they are not equivalent:
//
//   1. messaging_channels (the current path) — the company number, a rep's own
//      number, or a Wapilot instance. Each row carries its own sealed
//      credentials, so 'wapilot' exists only here. sendWhatsApp() resolves a
//      channel first and only falls back to the tenant config below.
//   2. site_config.whatsapp_config (legacy, tenant-wide) — 'meta' (token +
//      phoneId) or 'green-api' (instanceId + apiToken), with env vars as a
//      fallback so nothing has to be edited on the server.
//
// resolveProvider() and providerCredentialState() answer for (2) only. Anything
// asking "is WhatsApp configured?" has to look at both, or it will report on a
// channel no message actually travels through.
const { getTenantSetting } = require('./tenantSettings');
const { DEFAULT_TENANT } = require('../middleware/tenantContext');
const { resolveSecret } = require('./secretResolver');
const { toDialable } = require('./phoneNumber');

// ── Outbound category gate ────────────────────────────────────────────────────
// Which kinds of message may leave the system at all. This is enforced here, in
// the one function every send goes through, because the per-feature toggles in
// settings did not cover the senders: of the twenty call sites, most never read
// a setting before sending. Turning "رسائل الترحيب" off in the admin panel did
// nothing to routes/auth.js, which fired a welcome message on every signup with
// no check of any kind — so the numbers kept sending unsolicited traffic and
// kept getting banned for it.
//
// The list is an allowlist and the default is 'otp' alone. A send that does not
// name its category is refused, so a site added later, or one missed here, fails
// closed rather than quietly resuming. Widen it without a deploy:
//
//   WHATSAPP_OUTBOUND_CATEGORIES=otp,channel_test
//
// 'all' restores every category. Categories in use are listed in
// tests/whatsappOutboundGate.test.js, which also holds the line that every
// sendWhatsApp call names one.
const OUTBOUND_ALLOWLIST_RAW = String(process.env.WHATSAPP_OUTBOUND_CATEGORIES ?? 'otp').trim();
const OUTBOUND_ALLOW_ALL = OUTBOUND_ALLOWLIST_RAW.toLowerCase() === 'all';
const OUTBOUND_ALLOWED = new Set(
  OUTBOUND_ALLOWLIST_RAW.split(',').map(part => part.trim().toLowerCase()).filter(Boolean)
);

function isCategoryAllowed(category) {
  if (OUTBOUND_ALLOW_ALL) return true;
  const name = String(category || '').trim().toLowerCase();
  if (!name) return false;
  return OUTBOUND_ALLOWED.has(name);
}

function envSecret(name) {
  try { return resolveSecret(name); } catch (_) { return ''; }
}

function providerCredentialState(cfg = {}) {
  return {
    metaReady: Boolean(cfg.metaToken || envSecret('WHATSAPP_TOKEN'))
      && Boolean(cfg.metaPhoneId || process.env.WHATSAPP_PHONE_ID),
    greenReady: Boolean(cfg.instanceId || process.env.WA_INSTANCE_ID)
      && Boolean(cfg.apiToken || envSecret('WA_API_TOKEN')),
    ultraReady: Boolean(cfg.ultraInstanceId || process.env.ULTRAMSG_INSTANCE_ID)
      && Boolean(cfg.ultraToken || envSecret('ULTRAMSG_TOKEN')),
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
  if (cfg.provider === 'meta' || cfg.provider === 'green-api' || cfg.provider === 'ultramsg') return cfg.provider;
  if (cfg.metaToken || cfg.metaPhoneId) return 'meta';
  if (cfg.instanceId || cfg.apiToken) return 'green-api';
  // The institute's own number sits on UltraMsg — an instance named
  // «instance5000» rather than the numeric id Green API uses. Nothing here
  // spoke it, so a valid token reached no sender and OTP never left.
  if (cfg.ultraInstanceId || cfg.ultraToken
      || process.env.ULTRAMSG_INSTANCE_ID || envSecret('ULTRAMSG_TOKEN')) return 'ultramsg';
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
 * UltraMsg — the provider the institute's number is on.
 *
 * One instance, one number, a token per instance; the address is a plain
 * international number and the body is form-encoded. A stopped subscription
 * answers 404 with a JSON explanation, which is exactly what this account did
 * when the credentials were first tried, so that answer is carried back rather
 * than flattened into "failed".
 */
async function _sendUltraMsg(normalized, message, cfg) {
  const instanceId = cfg.ultraInstanceId || process.env.ULTRAMSG_INSTANCE_ID;
  const token = cfg.ultraToken || envSecret('ULTRAMSG_TOKEN');
  if (!instanceId || !token) {
    logger.warn('[WhatsApp] UltraMsg not configured — skipping notification');
    return { ok: false, provider: 'ultramsg', reason: 'not_configured' };
  }
  const instance = String(instanceId).startsWith('instance') ? String(instanceId) : `instance${instanceId}`;
  const res = await fetch(`https://api.ultramsg.com/${instance}/messages/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token, to: `+${String(normalized).replace(/\D/g, '')}`, body: message }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    logger.warn('[WhatsApp] UltraMsg error:', data);
    return { ok: false, provider: 'ultramsg', reason: data?.error || data };
  }
  return { ok: true, provider: 'ultramsg', idMessage: data.id || data.message || null };
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

    // Refused before the number is even normalised, before any channel budget is
    // claimed, and before the provider is touched — a blocked category must cost
    // the account nothing at all.
    if (!isCategoryAllowed(opts.category)) {
      logger.info('[WhatsApp] outbound category is disabled — not sending', {
        category: String(opts.category || '(none)'),
        allowed: OUTBOUND_ALLOW_ALL ? 'all' : [...OUTBOUND_ALLOWED].join(',') || '(none)',
      });
      return { ok: false, reason: 'category_disabled', category: opts.category || null };
    }

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
        : resolved.row.provider === 'wapilot'
          ? await require('./whatsappWapilot').sendViaWapilot(normalized, message, resolved.credentials)
          : resolved.row.provider === 'ultramsg'
            ? await _sendUltraMsg(normalized, message, resolved.credentials)
            : await _sendGreenApi(normalized, message, resolved.credentials);
      // A send is the only honest proof the credentials work, so the channel's
      // status follows the result rather than whatever it was set at save time.
      if (result.ok) await channels.markChannelConnected(tenantId, resolved.row.id).catch(() => {});
      else if (result.reason !== 'not_configured' && !isTransientSendFailure(result.reason)) {
        await channels.markChannelError(tenantId, resolved.row.id, describeReason(result.reason)).catch(() => {});
      } else if (isTransientSendFailure(result.reason)) {
        // Leave the channel connected. Marking it errored takes WhatsApp OTP
        // down until a human notices and re-tests, which is how one throttled
        // send turned into a dead sign-up flow: Wapilot answered "Too Many
        // Attempts", the channel was parked in `error`, getSendableChannel only
        // accepts `connected`, and every OTP afterwards failed while the
        // session at the provider stayed WORKING the whole time.
        logger.warn('[WhatsApp] transient send failure — channel left connected', {
          channelId: resolved.row.id, reason: describeReason(result.reason),
        });
      }
      return { ...result, channelId: resolved.row.id };
    }

    // Naming a channel that cannot send is an error, not an invitation to use a
    // different one. Silently substituting the company number here would make
    // the channel test report success while proving nothing.
    if (opts.channelId) {
      logger.warn('[WhatsApp] named channel is unavailable', { channelId: opts.channelId });
      return { ok: false, reason: 'channel_unavailable', channelId: opts.channelId };
    }

    const cfg = await getWaCfg(tenantId);
    const provider = resolveProvider(cfg);
    return provider === 'meta'
      ? await _sendMeta(normalized, message, cfg)
      : provider === 'ultramsg'
        ? await _sendUltraMsg(normalized, message, cfg)
        : await _sendGreenApi(normalized, message, cfg);
  } catch (e) {
    logger.warn('[WhatsApp] sendWhatsApp error:', e.message);
    return { ok: false, reason: e.message };
  }
}

/** Provider errors arrive as objects; store something a human can act on. */
function describeReason(reason) {
  if (!reason) return 'فشل الإرسال';
  // Not a failure — a deliberate refusal. Said plainly so a staff member does not
  // go hunting for a broken channel, and so it is not mistaken for a provider
  // error that should mark the channel unhealthy.
  if (reason === 'category_disabled') {
    return 'إرسال هذا النوع من الرسائل موقوف — المسموح حالياً رسائل التحقق (OTP) فقط.';
  }
  if (typeof reason === 'string') return reason;
  return reason?.error?.message || reason?.message || JSON.stringify(reason).slice(0, 400);
}

/**
 * Will this failure still be a failure in a minute?
 *
 * Throttling, a timeout and a network blip say nothing about whether the
 * credentials are good — the next send may well succeed. A rejected key or a
 * missing instance will fail identically until someone changes the settings,
 * and only those deserve to take the channel out of service.
 */
const TRANSIENT_PATTERNS = [
  /too many attempts/i,
  /rate.?limit/i,
  /\b429\b/,
  /timeout|timed out|abort/i,
  /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|socket hang up/i,
  /\b(502|503|504)\b/,
  /bad gateway|service unavailable|gateway timeout/i,
  /temporarily unavailable|try again/i,
];
function isTransientSendFailure(reason) {
  const text = describeReason(reason);
  return TRANSIENT_PATTERNS.some(pattern => pattern.test(text));
}

module.exports = {
  describeReason, getWaCfg, invalidateWaCfg, isTransientSendFailure,
  providerCredentialState, resolveProvider, sendWhatsApp,
};
