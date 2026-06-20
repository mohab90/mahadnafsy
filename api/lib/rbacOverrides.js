'use strict';
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
const { setRoleOverrides } = require('../constants/permissions');

let _timer = null;

async function loadRoleOverrides() {
  try {
    const [rows] = await pool.query("SELECT `value` FROM site_config WHERE `key` = 'content' LIMIT 1");
    if (!rows.length) { setRoleOverrides({}); return {}; }
    let content = rows[0].value;
    if (typeof content === 'string') { try { content = JSON.parse(content); } catch { content = {}; } }
    const raw = content && content['rbac.roleOverrides'];
    let overrides = {};
    if (raw) {
      try { overrides = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { overrides = {}; }
    }
    const applied = setRoleOverrides(overrides);
    return applied;
  } catch (e) {
    console.error('[rbacOverrides] load failed:', e.message);
    return null;
  }
}

/** Load once now, then refresh every `intervalMs` (default 60s). */
function startRbacRefresh(intervalMs = 60 * 1000) {
  loadRoleOverrides()
    .then(o => { if (o) console.log(`[rbacOverrides] loaded overrides for ${Object.keys(o).length} role(s)`); })
    .catch(() => {});
  if (_timer) clearInterval(_timer);
  _timer = setInterval(() => { loadRoleOverrides().catch(() => {}); }, intervalMs);
  if (_timer.unref) _timer.unref();
  return _timer;
}

module.exports = { loadRoleOverrides, startRbacRefresh };
