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

// Always open, whatever the allowlist: the institute's daily report to the
// numbers its owner saved in «تقارير الإدارة» (lib/ownerDailyReport.js), and
// alerts to its own staff (a lead gone quiet, lib/crmSla.js) — messages to its
// own people, never to a customer, which is not the traffic the allowlist
// exists to stop.
const ALWAYS_ALLOWED = new Set(['owner_report', 'staff_alert']);

// The kinds the owner opens from the panel («قنوات الرسائل ← أنواع الرسائل»),
// on top of the env allowlist: tenant setting 'whatsapp_outbound', read through
// a one-minute cache. The decision to resume customer messages after the bans is
// the owner's, so it is a switch in the panel and not an edit on the server.
const PANEL_CATEGORIES = new Set(['welcome', 'reminder', 'payment', 'crm', 'inbox_reply', 'automation', 'broadcast']);
const panelCache = new Map();
async function panelAllowed(tenantId) {
  const key = String(tenantId || DEFAULT_TENANT);
  const hit = panelCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  let value = new Set();
  try {
    const saved = await getTenantSetting('whatsapp_outbound', { tenantId: key, fallback: {} }) || {};
    value = new Set((Array.isArray(saved.categories) ? saved.categories : [])
      .map(name => String(name).toLowerCase()).filter(name => PANEL_CATEGORIES.has(name)));
  } catch (_) { value = hit?.value || new Set(); }
  panelCache.set(key, { value, at: Date.now() });
  return value;
}
function invalidateOutbound(tenantId) {
  if (tenantId) panelCache.delete(String(tenantId));
  else panelCache.clear();
}
async function isCategoryOpen(category, tenantId) {
  if (isCategoryAllowed(category)) return true;
  const name = String(category || '').trim().toLowerCase();
  return !!name && (await panelAllowed(tenantId)).has(name);
}
/** What may leave, and why: for the health card. */
async function outboundState(tenantId) {
  return {
    env: OUTBOUND_ALLOW_ALL ? ['all'] : [...OUTBOUND_ALLOWED],
    always: [...ALWAYS_ALLOWED],
    panel: [...(await panelAllowed(tenantId))],
    switchable: [...PANEL_CATEGORIES],
  };
}

function isCategoryAllowed(category) {
  if (OUTBOUND_ALLOW_ALL) return true;
  const name = String(category || '').trim().toLowerCase();
  if (!name) return false;
  return ALWAYS_ALLOWED.has(name) || OUTBOUND_ALLOWED.has(name);
}

function envSecret(name) {
  try { return resolveSecret(name); } catch (_) { return ''; }
}

// The provider credentials in the environment are the original institute's own
// number. Another institute without credentials of its own used to fall back
// to them, so its OTPs and messages went out from somebody else's company
// number. A config read for any other institute is marked here and gets
// nothing from the environment.
const FOREIGN_CFGS = new WeakSet();
function forTenant(cfg, tenantId) {
  if (!cfg || String(tenantId || DEFAULT_TENANT) === DEFAULT_TENANT) return cfg;
  const copy = { ...cfg };
  FOREIGN_CFGS.add(copy);
  return copy;
}
const platformEnv = (cfg, name) => (FOREIGN_CFGS.has(cfg) ? '' : process.env[name]);
const platformSecret = (cfg, name) => (FOREIGN_CFGS.has(cfg) ? '' : envSecret(name));

function providerCredentialState(cfg = {}) {
  return {
    metaReady: Boolean(cfg.metaToken || platformSecret(cfg, 'WHATSAPP_TOKEN'))
      && Boolean(cfg.metaPhoneId || platformEnv(cfg, 'WHATSAPP_PHONE_ID')),
    greenReady: Boolean(cfg.instanceId || platformEnv(cfg, 'WA_INSTANCE_ID'))
      && Boolean(cfg.apiToken || platformSecret(cfg, 'WA_API_TOKEN')),
    ultraReady: Boolean(cfg.ultraInstanceId || platformEnv(cfg, 'ULTRAMSG_INSTANCE_ID'))
      && Boolean(cfg.ultraToken || platformSecret(cfg, 'ULTRAMSG_TOKEN')),
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
  value = forTenant(value, scopedTenant);
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
      || platformEnv(cfg, 'ULTRAMSG_INSTANCE_ID') || platformSecret(cfg, 'ULTRAMSG_TOKEN')) return 'ultramsg';
  if (providerCredentialState(cfg).metaReady) return 'meta';
  return 'green-api';
}

// Meta WhatsApp Cloud API — plain text. NOTE: outside the 24h customer-service
// window Meta only allows pre-approved TEMPLATE messages; free-form text there is
// rejected (handled as a normal API error). Matches the format the watchdog uses.
async function _sendMeta(normalized, message, cfg) {
  return _sendMetaPayload(normalized, { type: 'text', text: { body: message } }, cfg);
}

async function _sendMetaPayload(normalized, content, cfg) {
  const token   = cfg.metaToken   || platformSecret(cfg, 'WHATSAPP_TOKEN');
  const phoneId = cfg.metaPhoneId || platformEnv(cfg, 'WHATSAPP_PHONE_ID');
  if (!token || !phoneId) {
    logger.warn('[WhatsApp] Meta not configured — skipping notification');
    return { ok: false, provider: 'meta', reason: 'not_configured' };
  }
  const res = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: normalized, ...content }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) { logger.warn('[WhatsApp] Meta API error:', data); return { ok: false, provider: 'meta', reason: data }; }
  return { ok: true, provider: 'meta', idMessage: data.messages?.[0]?.id };
}

// A provider that never answers held the outbox worker — and the money jobs that
// share its tick — until the row was reclaimed and sent again 15 minutes later.
// A send that times out is a transient failure (isTransientFailure) and retried.
const SEND_TIMEOUT_MS = 20000;

async function _sendGreenApi(normalized, message, cfg) {
  const instanceId = cfg.instanceId || platformEnv(cfg, 'WA_INSTANCE_ID');
  const apiToken   = cfg.apiToken   || platformSecret(cfg, 'WA_API_TOKEN');
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
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
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
  const instanceId = cfg.ultraInstanceId || platformEnv(cfg, 'ULTRAMSG_INSTANCE_ID');
  const token = cfg.ultraToken || platformSecret(cfg, 'ULTRAMSG_TOKEN');
  if (!instanceId || !token) {
    logger.warn('[WhatsApp] UltraMsg not configured — skipping notification');
    return { ok: false, provider: 'ultramsg', reason: 'not_configured' };
  }
  const instance = String(instanceId).startsWith('instance') ? String(instanceId) : `instance${instanceId}`;
  const res = await fetch(`https://api.ultramsg.com/${instance}/messages/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token, to: `+${String(normalized).replace(/\D/g, '')}`, body: message }).toString(),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
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
    if (!await isCategoryOpen(opts.category, tenantId)) {
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
        ? await _sendMeta(normalized, message, forTenant(resolved.credentials, tenantId))
        : resolved.row.provider === 'wapilot'
          ? await require('./whatsappWapilot').sendViaWapilot(normalized, message, forTenant(resolved.credentials, tenantId))
          : resolved.row.provider === 'ultramsg'
            ? await _sendUltraMsg(normalized, message, forTenant(resolved.credentials, tenantId))
            : await _sendGreenApi(normalized, message, forTenant(resolved.credentials, tenantId));
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

/** {name, language, params} → the template object Meta's send API takes. */
function buildTemplatePayload({ name, language, params = [] }) {
  // Meta refuses an empty parameter; a dash reads better than a failed send.
  const parameters = (Array.isArray(params) ? params : [])
    .map(value => ({ type: 'text', text: String(value ?? '').trim().slice(0, 1000) || '-' }));
  return {
    name: String(name || '').trim(),
    language: { code: String(language || 'ar').trim() || 'ar' },
    ...(parameters.length ? { components: [{ type: 'body', parameters }] } : {}),
  };
}

/**
 * Send an approved template — the only message Meta delivers to someone who
 * has not written in the last 24 hours, so the only way to start a
 * conversation or send a promotion from the company number. Same gate, same
 * channel resolution and same daily budget as sendWhatsApp; a template needs
 * the official API, so any other provider is refused rather than sent as text.
 *
 * @param {object} template { name, language, params: string[] }
 */
async function sendWhatsAppTemplate(phone, template, options = {}) {
  try {
    const tenantId = options.tenantId || DEFAULT_TENANT;
    if (!await isCategoryOpen(options.category, tenantId)) {
      return { ok: false, reason: 'category_disabled', category: options.category || null };
    }
    const normalized = toDialable(phone);
    if (!normalized) return { ok: false, reason: 'invalid_number' };
    if (!String(template?.name || '').trim()) return { ok: false, reason: 'template_required' };

    const channels = require('./messagingChannels');
    const resolved = await channels.getSendableChannel({
      tenantId, channelId: options.channelId || null, kind: 'whatsapp',
    }).catch(() => null);
    let cfg;
    let channelId = null;
    if (resolved) {
      channelId = resolved.row.id;
      if (resolved.row.provider !== 'meta') return { ok: false, reason: 'templates_need_meta', channelId };
      const withinBudget = await channels.claimSendBudget(tenantId, channelId).catch(() => true);
      if (!withinBudget) return { ok: false, reason: 'daily_limit_reached', channelId };
      cfg = forTenant(resolved.credentials, tenantId);
    } else {
      if (options.channelId) return { ok: false, reason: 'channel_unavailable', channelId: options.channelId };
      cfg = await getWaCfg(tenantId);
      if (resolveProvider(cfg) !== 'meta') return { ok: false, reason: 'templates_need_meta' };
    }
    const result = await _sendMetaPayload(normalized, { type: 'template', template: buildTemplatePayload(template) }, cfg);
    if (resolved && result.ok) await channels.markChannelConnected(tenantId, channelId).catch(() => {});
    return { ...result, channelId };
  } catch (e) {
    logger.warn('[WhatsApp] sendWhatsAppTemplate error:', e.message);
    return { ok: false, reason: e.message };
  }
}

/**
 * The company number's approved templates, from Meta. Needs the WhatsApp
 * Business Account id saved with the channel (metaWabaId): templates belong to
 * the account, not the number.
 *
 * @returns {Promise<{ok: boolean, templates?: object[], reason?: string}>}
 */
async function listMetaTemplates(tenantId) {
  const channels = require('./messagingChannels');
  const resolved = await channels.getSendableChannel({ tenantId, kind: 'whatsapp' }).catch(() => null);
  const cfg = resolved?.row.provider === 'meta' ? forTenant(resolved.credentials, tenantId) : (resolved ? null : await getWaCfg(tenantId));
  if (!cfg) return { ok: false, reason: 'templates_need_meta' };
  const token = cfg.metaToken || platformSecret(cfg, 'WHATSAPP_TOKEN');
  const wabaId = cfg.metaWabaId || platformEnv(cfg, 'WHATSAPP_WABA_ID');
  if (!token || !wabaId) return { ok: false, reason: 'waba_missing' };
  const res = await fetch(
    `https://graph.facebook.com/v19.0/${encodeURIComponent(wabaId)}/message_templates?fields=name,language,status,category,components&limit=200`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, reason: data?.error?.message || `HTTP ${res.status}` };
  return { ok: true, templates: (data.data || []).map(describeTemplate) };
}

/** A Meta template → what the composer needs: its text, how many {{n}} to fill, and whether this sender can fill it. */
function describeTemplate(t) {
  const components = Array.isArray(t.components) ? t.components : [];
  const body = components.find(c => c.type === 'BODY')?.text || '';
  const header = components.find(c => c.type === 'HEADER');
  const params = Math.max(0, ...[...body.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1])));
  // Only body variables are filled here. A header with a variable or a picture,
  // or a button with a variable link, needs values this sender does not send.
  const needsMore = Boolean(header && (header.format !== 'TEXT' || /\{\{/.test(header.text || '')))
    || components.some(c => c.type === 'BUTTONS' && (c.buttons || []).some(b => /\{\{/.test(b.url || '')));
  return {
    name: t.name, language: t.language, status: t.status, category: t.category,
    body, header: header?.format === 'TEXT' ? header.text : null, params,
    usable: t.status === 'APPROVED' && !needsMore,
  };
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
  describeReason, getWaCfg, invalidateOutbound, invalidateWaCfg, isCategoryOpen, isTransientSendFailure,
  forTenant, outboundState, providerCredentialState, resolveProvider, sendWhatsApp,
  sendWhatsAppTemplate, listMetaTemplates, describeTemplate, buildTemplatePayload,
};
