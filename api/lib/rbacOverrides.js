'use strict';
const logger = require('./logger');
/**
 * RBAC role-override loader.
 * The admin edits per-role permissions in the Settings page; those are persisted
 * to site_config (key 'content', JSON blob, inner key 'rbac.roleOverrides').
 * This module loads them into the permissions module (setRoleOverrides) at
 * startup and refreshes on an interval so backend enforcement stays in sync with
 * the UI without a restart. config.js also calls loadRoleOverrides() right after
 * a content save for immediate effect.
 */
const { pool } = require('./db');
const { getTenantSetting } = require('./tenantSettings');
const { DEFAULT_TENANT } = require('../middleware/tenantContext');
const { setRoleOverrides } = require('../constants/permissions');

let _timer = null;

async function loadRoleOverrides(tenantId = DEFAULT_TENANT) {
  try {
    const content = await getTenantSetting('content', { tenantId, fallback: {} }) || {};
    const raw = content && content['rbac.roleOverrides'];
    let overrides = {};
    if (raw) {
      try { overrides = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { overrides = {}; }
    }
    const applied = setRoleOverrides(overrides, tenantId);
    return applied;
  } catch (e) {
    logger.error('[rbacOverrides] load failed:', e.message);
    return null;
  }
}

/** Load once now, then refresh every `intervalMs` (default 60s). */
function startRbacRefresh(intervalMs = 60 * 1000) {
  const refresh = async () => {
    const [rows] = await pool.query("SELECT id FROM tenants WHERE status='active'").catch(() => [[]]);
    const tenantIds = rows.length ? rows.map(row => row.id) : [DEFAULT_TENANT];
    await Promise.all(tenantIds.map(tenantId => loadRoleOverrides(tenantId)));
  };
  refresh().catch(() => {});
  if (_timer) clearInterval(_timer);
  _timer = setInterval(() => { refresh().catch(() => {}); }, intervalMs);
  if (_timer.unref) _timer.unref();
  return _timer;
}

module.exports = { loadRoleOverrides, startRbacRefresh };
