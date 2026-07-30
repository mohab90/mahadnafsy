'use strict';

const { isIP } = require('node:net');
const { pool } = require('../lib/db');
const logger = require('../lib/logger').child({ middleware: 'ipWhitelist' });

const cache = new Map();
const TTL_MS = 60 * 1000;

function normalizeIp(value) {
  return String(value || '')
    .split(',')[0]
    .trim()
    .replace(/^::ffff:/, '')
    .replace(/^\[|\]$/g, '');
}

function ipv4Number(value) {
  if (isIP(value) !== 4) return null;
  return value.split('.').reduce((total, octet) => ((total << 8) | Number(octet)) >>> 0, 0);
}

function matches(ipValue, ruleValue) {
  const ip = normalizeIp(ipValue);
  const [network, prefixText, extra] = normalizeIp(ruleValue).split('/');
  if (extra !== undefined || isIP(ip) !== 4 || isIP(network) !== 4) return false;
  if (prefixText === undefined) return network === ip;
  if (!/^\d{1,2}$/.test(prefixText)) return false;
  const prefix = Number(prefixText);
  if (prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4Number(ip) & mask) === (ipv4Number(network) & mask);
}

function isLoopback(ip) {
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

function invalidateIpWhitelist(tenantId) {
  cache.delete(String(tenantId || 'tenant-default'));
}

async function loadWhitelist(tenantId) {
  const key = String(tenantId || 'tenant-default');
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.values;
  const [rows] = await pool.query(
    'SELECT ip FROM ip_whitelist WHERE tenant_id=? ORDER BY created_at DESC',
    [key]
  );
  const values = rows.map(row => String(row.ip || '').trim()).filter(Boolean);
  cache.set(key, { values, ts: Date.now() });
  return values;
}

async function enforceAdminIpWhitelist(req, res, next) {
  if (process.env.IP_WHITELIST_ENFORCE !== 'true') return next();
  if (!req.path.startsWith('/api/admin')) return next();
  if (req.path.startsWith('/api/admin/ip-whitelist')) return next();
  try {
    const whitelist = await loadWhitelist(req.tenantId);
    if (!whitelist.length) return next();
    const ip = normalizeIp(req.ip || req.socket?.remoteAddress);
    if (process.env.NODE_ENV !== 'production' && isLoopback(ip)) return next();
    if (whitelist.some(rule => matches(ip, rule))) return next();
    logger.warn('admin ip blocked', { tenantId: req.tenantId, ip, path: req.path });
    return res.status(403).json({ error: 'IP not whitelisted', code: 'IP_NOT_WHITELISTED' });
  } catch (error) {
    logger.error('ip whitelist unavailable while enforcement is active', {
      tenantId: req.tenantId,
      error: error.message,
    });
    return res.status(503).json({ error: 'IP access policy unavailable', code: 'IP_POLICY_UNAVAILABLE' });
  }
}

module.exports = {
  enforceAdminIpWhitelist,
  invalidateIpWhitelist,
  _test: { ipv4Number, matches, normalizeIp },
};
