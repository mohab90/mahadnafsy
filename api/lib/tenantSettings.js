'use strict';

const { pool } = require('./db');
const { uuidv4 } = require('./id');
const { DEFAULT_TENANT } = require('../middleware/tenantContext');

const MISSING_TABLE = /doesn't exist|unknown table|no such table/i;

function normalizeTenantId(tenantId) {
  const value = String(tenantId || DEFAULT_TENANT).trim();
  if (!value || value.length > 36) throw new Error('Invalid tenant id');
  return value;
}

function normalizeSettingKey(key) {
  const value = String(key || '').trim();
  if (!/^[a-z0-9_.:-]{1,100}$/i.test(value)) throw new Error('Invalid setting key');
  return value;
}

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  try { return typeof value === 'string' ? JSON.parse(value) : value; }
  catch (_) { return fallback; }
}

async function readLegacyDefault(key, fallback, db) {
  const [[row]] = await db.query('SELECT `value` FROM site_config WHERE `key`=? LIMIT 1', [key]);
  return parseJson(row?.value, fallback);
}

/**
 * Tenant-scoped settings repository. The default tenant may read the legacy
 * site_config row during migration rollout; non-default tenants always fail
 * closed when tenant_settings is unavailable.
 */
async function getTenantSetting(key, { tenantId, fallback = null, db = pool } = {}) {
  const scopedTenant = normalizeTenantId(tenantId);
  const scopedKey = normalizeSettingKey(key);
  try {
    const [[row]] = await db.query(
      'SELECT config_json FROM tenant_settings WHERE tenant_id=? AND section=? LIMIT 1',
      [scopedTenant, scopedKey]
    );
    if (row) return parseJson(row.config_json, fallback);
  } catch (error) {
    if (!MISSING_TABLE.test(error.message || '') || scopedTenant !== DEFAULT_TENANT) throw error;
    return readLegacyDefault(scopedKey, fallback, db);
  }
  if (scopedTenant === DEFAULT_TENANT) return readLegacyDefault(scopedKey, fallback, db);
  return fallback;
}

async function setTenantSetting(key, value, { tenantId, actorId: _actorId = null, db = pool } = {}) {
  const scopedTenant = normalizeTenantId(tenantId);
  const scopedKey = normalizeSettingKey(key);
  const serialized = JSON.stringify(value);
  try {
    await db.query(
      `INSERT INTO tenant_settings (id, tenant_id, section, config_json, is_secret)
       VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE config_json=VALUES(config_json), is_secret=VALUES(is_secret)`,
      [uuidv4(), scopedTenant, scopedKey, serialized, /^sys_(payment_gateway|lead_source_connectors|otp_provider)$/.test(scopedKey) ? 1 : 0]
    );
  } catch (error) {
    if (!MISSING_TABLE.test(error.message || '') || scopedTenant !== DEFAULT_TENANT) throw error;
    await db.query(
      'INSERT INTO site_config (`key`, `value`) VALUES (?,?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)',
      [scopedKey, serialized]
    );
  }
}

module.exports = {
  getTenantSetting,
  normalizeSettingKey,
  normalizeTenantId,
  parseJson,
  setTenantSetting,
};
