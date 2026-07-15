'use strict';

const { pool } = require('../lib/db');
const logger = require('../lib/logger').child({ middleware: 'ipWhitelist' });

let cache = { values: null, ts: 0 };
const TTL_MS = 60 * 1000;

function normalizeIp(value) {
  return String(value || '')
    .split(',')[0]
    .trim()
    .replace(/^::ffff:/, '')
    .replace(/^\[|\]$/g, '');
}

function isLoopback(ip) {
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

function matches(ip, rule) {
  const value = normalizeIp(rule);
  if (!value) return false;
  if (value === ip) return true;
  if (value.endsWith('.*')) return ip.startsWith(`${value.slice(0, -2)}.`);
  return false;
}

async function loadWhitelist() {
  if (cache.values && Date.now() - cache.ts < TTL_MS) return cache.values;
  let values = [];
  try {
    const [rows] = await pool.query('SELECT ip FROM ip_whitelist ORDER BY created_at DESC');
    values = rows.map((row) => normalizeIp(row.ip)).filter(Boolean);
  } catch (error) {
    try {
      const [[row]] = await pool.query("SELECT value FROM site_config WHERE `key`='admin_ip_whitelist' LIMIT 1");
      const parsed = row?.value ? JSON.parse(row.value) : [];
      values = Array.isArray(parsed) ? parsed.map(normalizeIp).filter(Boolean) : [];
    } catch (fallbackError) {
      logger.warn('ip whitelist unavailable; fail-open', { error: fallbackError.message || error.message });
      values = [];
    }
  }
  cache = { values, ts: Date.now() };
  return values;
}

async function enforceAdminIpWhitelist(req, res, next) {
  try {
    const whitelist = await loadWhitelist();
    if (!whitelist.length) return next();
    const ip = normalizeIp(req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress);
    if (process.env.NODE_ENV !== 'production' && isLoopback(ip)) return next();
    if (whitelist.some((rule) => matches(ip, rule))) return next();
    logger.warn('admin ip blocked', { ip });
    return res.status(403).json({ error: 'IP not whitelisted' });
  } catch (error) {
    logger.warn('ip whitelist check failed; fail-open', { error: error.message });
    return next();
  }
}

module.exports = { enforceAdminIpWhitelist, _test: { normalizeIp, matches } };
