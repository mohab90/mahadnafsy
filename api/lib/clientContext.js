'use strict';

const crypto = require('crypto');
const net = require('net');
const logger = require('./logger').child({ lib: 'client-context' });
const { resolveSecret } = require('./secretResolver');

const VALID_COUNTRY = /^[A-Z]{2}$/;
const CACHE_TTL_MS = Math.max(60_000, Number(process.env.GEOIP_CACHE_TTL_MS) || 30 * 60_000);
const CACHE_MAX = Math.max(100, Number(process.env.GEOIP_CACHE_MAX) || 10_000);
const cache = new Map();

function normalizeCountryCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return VALID_COUNTRY.test(code) && code !== 'XX' && code !== 'T1' ? code : null;
}

function currencyForCountry(countryCode) {
  return countryCode === 'EG' ? 'EGP' : countryCode === 'SA' ? 'SAR' : 'USD';
}

function branchForCountry(countryCode) {
  return countryCode === 'EG' ? 'ONLINE_EGYPT'
    : countryCode === 'SA' ? 'ONLINE_SAUDI'
      : 'ONLINE_ABROAD';
}

function normalizeClientIp(value) {
  let ip = String(value || '').trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip.startsWith('[') && ip.includes(']')) ip = ip.slice(1, ip.indexOf(']'));
  return net.isIP(ip) ? ip : '';
}

function getClientIp(req) {
  return normalizeClientIp(req?.ip || req?.socket?.remoteAddress || req?.connection?.remoteAddress);
}

function isPrivateIp(ip) {
  if (!ip) return true;
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80:');
  }
  const parts = ip.split('.').map(Number);
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

function hashClientIp(ip) {
  const secret = resolveSecret('SESSION_BINDING_SECRET') || resolveSecret('JWT_SECRET');
  if (!secret) throw new Error('SESSION_BINDING_SECRET or JWT_SECRET is required');
  return crypto.createHmac('sha256', secret).update(normalizeClientIp(ip) || 'unknown').digest('hex');
}

function trustedHeaderCountry(req) {
  if (process.env.NODE_ENV === 'test') {
    const testCode = normalizeCountryCode(req?.get?.('x-test-country-code'));
    if (testCode) return { countryCode: testCode, source: 'test-header' };
  }
  if (String(process.env.TRUST_GEO_HEADERS || '').toLowerCase() !== 'true') return null;
  for (const header of ['cf-ipcountry', 'x-vercel-ip-country', 'cloudfront-viewer-country']) {
    const countryCode = normalizeCountryCode(req?.get?.(header));
    if (countryCode) return { countryCode, source: header };
  }
  return null;
}

function configuredDefault() {
  return normalizeCountryCode(process.env.GEO_DEFAULT_COUNTRY_CODE)
    || (process.env.NODE_ENV !== 'production' ? 'EG' : null);
}

function parseProviderCountry(body) {
  return normalizeCountryCode(body?.country || body?.country_code || body?.countryCode);
}

async function providerCountry(ip, fetchImpl = global.fetch) {
  if (typeof fetchImpl !== 'function' || !ip || isPrivateIp(ip)) return null;
  const template = process.env.GEOIP_API_URL || 'https://api.country.is/{ip}';
  if (!/^https:\/\//i.test(template)) throw new Error('GEOIP_API_URL must use HTTPS');
  const url = template.includes('{ip}')
    ? template.replace('{ip}', encodeURIComponent(ip))
    : `${template.replace(/\/$/, '')}/${encodeURIComponent(ip)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(500, Number(process.env.GEOIP_TIMEOUT_MS) || 2500));
  try {
    const response = await fetchImpl(url, {
      headers: process.env.GEOIP_API_TOKEN ? { Authorization: `Bearer ${process.env.GEOIP_API_TOKEN}` } : {},
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Geo provider HTTP ${response.status}`);
    return parseProviderCountry(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

function context(countryCode, source, resolved = true) {
  return {
    countryCode: countryCode || null,
    currency: currencyForCountry(countryCode),
    branch: branchForCountry(countryCode),
    source,
    locationResolved: resolved,
  };
}

async function resolveClientContext(req, { fetchImpl = global.fetch } = {}) {
  const header = trustedHeaderCountry(req);
  if (header) return context(header.countryCode, header.source);

  const ip = getClientIp(req);
  const fallback = configuredDefault();
  if (isPrivateIp(ip)) {
    return fallback ? context(fallback, 'configured-default') : context(null, 'private-ip-unresolved', false);
  }

  const key = crypto.createHash('sha256').update(ip).digest('hex');
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  try {
    const countryCode = await providerCountry(ip, fetchImpl);
    const value = countryCode
      ? context(countryCode, 'geo-provider')
      : fallback ? context(fallback, 'configured-default') : context(null, 'provider-unresolved', false);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (error) {
    logger.warn('country lookup failed', { error: error.message });
    return fallback ? context(fallback, 'configured-default') : context(null, 'provider-unavailable', false);
  }
}

module.exports = {
  normalizeCountryCode,
  currencyForCountry,
  branchForCountry,
  normalizeClientIp,
  getClientIp,
  isPrivateIp,
  hashClientIp,
  resolveClientContext,
  _test: { parseProviderCountry, trustedHeaderCountry, cache },
};
