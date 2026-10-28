'use strict';

// Dropped in every API process at once, not only the one that took the save.
const { shared } = require('./cacheBus');

/**
 * Meta's Conversions API: the same Lead and Purchase the browser pixel sends,
 * sent again from here so an ad blocker, Safari's tracking prevention or a tab
 * closed on the payment page does not lose the conversion.
 *
 * «تتبّع الإعلانات صح» (11 Oct 2026). The pixel fired one PageView on the first
 * page and nothing else, so the ads were optimised on visits rather than on the
 * people who left their number or paid.
 *
 * Every event carries the event_id the browser used for its own copy, so Meta
 * counts it once: a lead form sends it as X-Event-Id (client/lib/tracking.ts),
 * and a purchase is «purchase-<order id>» on both sides.
 *
 * Nothing here may cost a request anything. Unconfigured, it does nothing;
 * configured, it is fire-and-forget with a timeout, and it never throws.
 */
const crypto = require('node:crypto');
const logger = require('./logger').child({ module: 'meta-capi' });
const { getTenantSetting } = require('./tenantSettings');
const { DEFAULT_TENANT_ID, platformFallback } = require('./tenantScope');
const { resolveSecret } = require('./secretResolver');
const { toDialable } = require('./phoneNumber');
const { getClientIp } = require('./clientContext');

// The pixel the site has always loaded — client/index.html, fbq('init', …). A
// test reads both, so the two cannot drift apart. It is this institute's alone:
// another tenant gets no pixel unless it names its own.
const SITE_PIXEL_ID = '1879086466096343';
const { GRAPH_VERSION } = require('./metaGraph');
const TIMEOUT_MS = 4000;
const CONFIG_TTL_MS = 60 * 1000;
const EVENT_ID = /^[A-Za-z0-9_.:~-]{6,100}$/;
const FBP = /^fb\.\d\.\d{10,16}\.\d{1,30}$/;
const FBC = /^fb\.\d\.\d{10,16}\.[A-Za-z0-9_-]{1,400}$/;

const sha256 = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

// Meta's normalisation, before hashing: an address trimmed and lower-cased; a
// number as digits with its country code and no leading zeros or «+» (the same
// dialable form WhatsApp is addressed with — 01012345678 is 201012345678); a
// name lower-cased with no spaces or punctuation.
function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}
function normalizePhone(value) {
  return toDialable(value);
}
function normalizeName(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '');
}

function readCookie(req, name) {
  const match = String(req?.headers?.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  if (!match) return '';
  try { return decodeURIComponent(match[1]).trim(); } catch { return ''; }
}

/**
 * The browser's refusal, where there is one. The site has no cookie banner, so
 * what is honoured is what exists: Global Privacy Control (the Sec-GPC header a
 * browser sends on its own) and the «denied» a future banner stores, which the
 * page forwards as X-Ad-Consent.
 */
function consentDenied(req) {
  const headers = req?.headers || {};
  return String(headers['sec-gpc'] || '').trim() === '1'
    || /^denied$/i.test(String(headers['x-ad-consent'] || '').trim());
}

/** The page the form was on: the Referer of a same-site fetch. */
function sourceUrl(req) {
  const raw = String(req?.headers?.referer || req?.headers?.referrer || '').trim();
  return /^https?:\/\//i.test(raw) ? raw.slice(0, 1000) : '';
}

/**
 * What ties a server event to the visitor's ad click: their address and
 * browser, the pixel's two cookies, the page, and the browser's event id. Stored
 * on an order (notes.adContext) for the purchase that comes later through
 * Paymob, where no browser is in the request.
 */
function adContextFromRequest(req) {
  const url = sourceUrl(req);
  let fbc = readCookie(req, '_fbc');
  if (!FBC.test(fbc)) {
    // The pixel writes _fbc from the landing page's fbclid; a visitor whose
    // pixel had not run yet still carries the click in the page's address.
    let fbclid = '';
    try { fbclid = url ? new URL(url).searchParams.get('fbclid') || '' : ''; } catch { fbclid = ''; }
    fbc = /^[A-Za-z0-9_-]{1,400}$/.test(fbclid) ? `fb.1.${Date.now()}.${fbclid}` : '';
  }
  const fbp = readCookie(req, '_fbp');
  const eventId = String(req?.headers?.['x-event-id'] || '').trim();
  return {
    consent: !consentDenied(req),
    ip: getClientIp(req) || '',
    ua: String(req?.headers?.['user-agent'] || '').slice(0, 500),
    fbp: FBP.test(fbp) ? fbp : '',
    fbc,
    url,
    eventId: EVENT_ID.test(eventId) ? eventId : '',
  };
}

/** One event in the shape the API takes. Pure, so it is tested without a network. */
function buildEvent({ eventName, eventId, eventTime = Math.floor(Date.now() / 1000), context = {}, user = {}, custom = null }) {
  const userData = {};
  const email = normalizeEmail(user.email);
  const phone = normalizePhone(user.phone);
  if (email) userData.em = [sha256(email)];
  if (phone) userData.ph = [sha256(phone)];
  const names = String(user.name || '').trim().split(/\s+/).filter(Boolean);
  const first = normalizeName(names[0]);
  const last = names.length > 1 ? normalizeName(names[names.length - 1]) : '';
  if (first) userData.fn = [sha256(first)];
  if (last) userData.ln = [sha256(last)];
  if (user.externalId) userData.external_id = [sha256(String(user.externalId))];
  if (context.ip) userData.client_ip_address = context.ip;
  if (context.ua) userData.client_user_agent = context.ua;
  if (context.fbp) userData.fbp = context.fbp;
  if (context.fbc) userData.fbc = context.fbc;
  const event = {
    event_name: eventName,
    event_time: eventTime,
    action_source: 'website',
    user_data: userData,
  };
  if (eventId) event.event_id = eventId;
  if (context.url) event.event_source_url = context.url;
  if (custom && Object.keys(custom).length) event.custom_data = custom;
  return event;
}

const configCache = new Map();

function envToken(tenantId) {
  let token = '';
  try { token = resolveSecret('META_CAPI_TOKEN'); } catch (error) {
    logger.warn('[meta-capi] META_CAPI_TOKEN is misconfigured', { error: error.message });
  }
  return platformFallback(tenantId, token) || '';
}

async function readOwnSettings(tenantId) {
  try {
    const settings = await getTenantSetting('settings', { tenantId, fallback: {} });
    return settings && typeof settings.metaCapi === 'object' && settings.metaCapi ? settings.metaCapi : {};
  } catch (error) {
    logger.warn('[meta-capi] settings unavailable', { error: error.message });
    return {};
  }
}

/**
 * Each value with where it came from: the institute's own setting, else for
 * the default institute the environment (and, for the pixel, the one the site
 * already loads). The settings screen shows the sources; nothing else needs them.
 */
function resolveParts(tenantId, own) {
  const ownPixel = String(own.pixelId || '').trim();
  const envPixel = String(platformFallback(tenantId, process.env.META_PIXEL_ID) || '').trim();
  const sitePixel = String(platformFallback(tenantId, SITE_PIXEL_ID) || '');
  const ownToken = String(own.accessToken || '').trim();
  const ownCode = String(own.testEventCode || '').trim();
  const envCode = String(platformFallback(tenantId, process.env.META_CAPI_TEST_EVENT_CODE) || '').trim();
  const source = (mine, env, site = '') => (mine ? 'settings' : env ? 'env' : site ? 'site' : 'none');
  // The environment's token is read only when the institute has none of its
  // own: resolving it can touch a file (META_CAPI_TOKEN_FILE).
  const envTok = ownToken ? '' : envToken(tenantId);
  return {
    enabled: own.enabled !== false,
    pixelId: ownPixel || envPixel || sitePixel,
    pixelSource: source(ownPixel, envPixel, sitePixel),
    token: ownToken || envTok,
    tokenSource: source(ownToken, envTok),
    testEventCode: ownCode || envCode,
    testEventCodeSource: source(ownCode, envCode),
  };
}

/**
 * Which pixel, and the token to send to it: the institute's own setting first
 * (settings.metaCapi — { pixelId, accessToken, testEventCode, enabled }), else
 * for the default institute META_PIXEL_ID / the site's pixel and
 * META_CAPI_TOKEN. Null when either is missing — then nothing is sent.
 */
async function loadConfig(tenantId = DEFAULT_TENANT_ID) {
  const hit = configCache.get(tenantId);
  if (hit && Date.now() - hit.at < CONFIG_TTL_MS) return hit.value;
  const parts = resolveParts(tenantId, await readOwnSettings(tenantId));
  let value = null;
  if (parts.enabled && /^\d{5,20}$/.test(parts.pixelId) && parts.token) {
    value = { pixelId: parts.pixelId, token: parts.token, testEventCode: parts.testEventCode };
  }
  configCache.set(tenantId, { value, at: Date.now() });
  return value;
}

/** A saved change takes effect now rather than after the cache's minute. */
const invalidateConfig = shared('meta-capi-config', function invalidateConfigHere(tenantId = DEFAULT_TENANT_ID) {
  configCache.delete(tenantId);
});

/**
 * The settings screen's view: what is saved, what is in effect and where each
 * part came from. Whether there is a token and where — never the token.
 */
async function describeConfig(tenantId = DEFAULT_TENANT_ID) {
  const own = await readOwnSettings(tenantId);
  const parts = resolveParts(tenantId, own);
  const pixelValid = /^\d{5,20}$/.test(parts.pixelId);
  return {
    saved: {
      enabled: own.enabled !== false,
      pixelId: String(own.pixelId || '').trim(),
      hasToken: Boolean(String(own.accessToken || '').trim()),
      testEventCode: String(own.testEventCode || '').trim(),
    },
    effective: {
      configured: parts.enabled && pixelValid && Boolean(parts.token),
      enabled: parts.enabled,
      pixelId: parts.pixelId,
      pixelValid,
      pixelSource: parts.pixelSource,
      hasToken: Boolean(parts.token),
      tokenSource: parts.tokenSource,
      testEventCode: parts.testEventCode,
      testEventCodeSource: parts.testEventCodeSource,
    },
  };
}

/** The request itself. Its URL carries the token, so it is never logged or returned. */
function postToMeta(config, event) {
  const body = { data: [event] };
  if (config.testEventCode) body.test_event_code = config.testEventCode;
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${config.pixelId}/events?access_token=${encodeURIComponent(config.token)}`;
  return globalThis.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** Sends one event. Resolves to { sent, status? , reason? }; never rejects. */
async function sendEvent(tenantId, event) {
  try {
    const config = await loadConfig(tenantId || DEFAULT_TENANT_ID);
    if (!config) return { sent: false, reason: 'not_configured' };
    const response = await postToMeta(config, event);
    if (!response.ok) {
      // The status and Meta's own message, never the URL: it carries the token.
      const detail = await response.json().catch(() => null);
      logger.warn('[meta-capi] event refused', {
        event: event.event_name, status: response.status, error: String(detail?.error?.message || '').slice(0, 200),
      });
      return { sent: false, status: response.status };
    }
    return { sent: true, status: response.status };
  } catch (error) {
    logger.warn('[meta-capi] event not sent', { event: event?.event_name, error: error.name === 'TimeoutError' ? 'timeout' : error.message });
    return { sent: false, reason: 'error' };
  }
}

/**
 * «إرسال حدث تجريبي» on the settings screen: one Lead, under the test event
 * code when there is one so it lands in Events Manager's «Test events» and not
 * in the ads' numbers. Answers with Meta's status or its message, with the
 * token cut out of anything that might echo it.
 */
async function sendTestEvent(tenantId = DEFAULT_TENANT_ID, { userAgent = '' } = {}) {
  invalidateConfig(tenantId);
  const config = await loadConfig(tenantId);
  if (!config) return { ok: false, reason: 'not_configured' };
  const scrub = text => String(text || '').split(config.token).join('••••').slice(0, 300);
  const event = buildEvent({
    eventName: 'Lead',
    eventId: `admin-test-${crypto.randomUUID()}`,
    // No visitor here, so the admin's browser stands in; Meta wants at least
    // one identifier, and the institute's id hashed is one that names nobody.
    context: { ua: String(userAgent).slice(0, 500), url: String(process.env.PUBLIC_SITE_URL || 'https://mahadnafsy.com') },
    user: { externalId: `meta-capi-test:${tenantId}` },
    custom: { content_name: 'Conversions API test' },
  });
  const usedTestCode = Boolean(config.testEventCode);
  try {
    const response = await postToMeta(config, event);
    const detail = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        ok: false, status: response.status, usedTestCode,
        message: scrub(detail?.error?.error_user_msg || detail?.error?.message || ''),
      };
    }
    return { ok: true, status: response.status, usedTestCode, eventsReceived: Number(detail?.events_received) || 0 };
  } catch (error) {
    return { ok: false, usedTestCode, message: error.name === 'TimeoutError' ? 'timeout' : scrub(error.message) };
  }
}

/**
 * Lead, from the request a lead form posted. Not awaited by the route: the
 * answer goes back to the visitor whatever Meta does.
 */
function trackLead(req, { name, email, phone, contentName, leadId } = {}) {
  const context = adContextFromRequest(req);
  if (!context.consent) return Promise.resolve({ sent: false, reason: 'consent' });
  const custom = contentName ? { content_name: String(contentName).slice(0, 200) } : null;
  return sendEvent(req?.tenantId, buildEvent({
    eventName: 'Lead', eventId: context.eventId, context, custom,
    user: { name, email, phone, externalId: leadId },
  }));
}

/** The id both the success page and this side give a purchase, so Meta keeps one. */
const purchaseEventId = orderId => `purchase-${orderId}`;

/** Purchase, once Paymob's verified callback has marked the order paid. */
function trackPurchase({ tenantId, order, adContext }) {
  const context = adContext && typeof adContext === 'object' ? adContext : {};
  if (context.consent === false) return Promise.resolve({ sent: false, reason: 'consent' });
  const value = Number(order?.amount);
  if (!order?.id || !Number.isFinite(value) || value <= 0) return Promise.resolve({ sent: false, reason: 'no_value' });
  return sendEvent(tenantId || order.tenant_id, buildEvent({
    eventName: 'Purchase',
    eventId: purchaseEventId(order.id),
    context,
    user: { name: order.customer_name, email: order.customer_email, phone: order.customer_phone, externalId: order.subscriber_id },
    custom: {
      value,
      currency: String(order.currency || 'EGP').toUpperCase(),
      content_ids: order.item_id ? [String(order.item_id)] : undefined,
      content_type: 'product',
      content_name: order.item_title ? String(order.item_title).slice(0, 200) : undefined,
      order_id: String(order.id),
    },
  }));
}

module.exports = {
  SITE_PIXEL_ID,
  adContextFromRequest,
  buildEvent,
  consentDenied,
  describeConfig,
  invalidateConfig,
  purchaseEventId,
  sendTestEvent,
  trackLead,
  trackPurchase,
  _test: { loadConfig, sendEvent, normalizeEmail, normalizePhone, normalizeName, configCache },
};
