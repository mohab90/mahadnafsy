'use strict';

// Where a visitor came from — the ad parameters of their first visit.
//
// The site keeps utm_source/medium/campaign/content/term and the click ids
// (fbclid, gclid) from the first page of a visit (client/lib/attribution.ts),
// in sessionStorage and in a session cookie, and sends them with every lead
// form, sign-up and order. They reach here either as the body's `attribution`
// object or, for a request whose body the page does not build itself, as the
// `mahad_attr` cookie. Nothing in them is trusted beyond being short text: they
// are written to leads and orders for the desk and the campaign report.

const FIELDS = Object.freeze(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid']);
const LIMITS = Object.freeze({ fbclid: 255, gclid: 255 });
const COOKIE = 'mahad_attr';

/** Only the known keys, each trimmed, stripped of control characters and cut to its column. */
function cleanAttribution(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const field of FIELDS) {
    const value = raw[field];
    if (value === undefined || value === null || typeof value === 'object') continue;
    // eslint-disable-next-line no-control-regex
    const text = String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, LIMITS[field] || 200);
    if (text) out[field] = text;
  }
  return out;
}

function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return '';
}

/** The visit's attribution for this request: the body's when it carries one, else the cookie's. */
function attributionFromRequest(req) {
  const fromBody = cleanAttribution(req?.body?.attribution);
  if (Object.keys(fromBody).length) return fromBody;
  const raw = cookieValue(req?.headers?.cookie, COOKIE);
  if (!raw || raw.length > 4096) return {};
  try { return cleanAttribution(JSON.parse(decodeURIComponent(raw))); } catch { return {}; }
}

/** The values in FIELDS order, null where missing — for an INSERT's placeholders. */
function attributionValues(attribution) {
  return FIELDS.map(field => attribution?.[field] || null);
}

/**
 * SET terms that fill a row's attribution only where it has none: the first
 * visit that brought the person is the one kept, a later form does not rewrite it.
 */
function fillAttributionSql(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return FIELDS.map(field => `${prefix}${field}=COALESCE(NULLIF(${prefix}${field},''), ?)`).join(', ');
}

/** «فيسبوك · campaign» for a person reading the lead card. */
function attributionLabel(attribution) {
  if (!attribution) return '';
  const source = attribution.utm_source || (attribution.fbclid ? 'facebook' : attribution.gclid ? 'google' : '');
  return [source, attribution.utm_medium, attribution.utm_campaign].filter(Boolean).join(' · ');
}

module.exports = { FIELDS, COOKIE, cleanAttribution, attributionFromRequest, attributionValues, fillAttributionSql, attributionLabel };
