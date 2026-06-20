'use strict';
/**
 * Per-tenant feature flags, plan limits, and usage metering (Top20 #3/#4/#5).
 * Backed by tenant_plans / tenant_feature_flags / tenant_usage (migration 012).
 * All calls degrade gracefully (fail-open for flags, permissive for limits) if
 * the tables are missing, so single-tenant operation is never blocked.
 */
const { pool } = require('./db');
const logger = require('./logger');
const { DEFAULT_TENANT } = require('../middleware/tenantContext');

async function isFeatureEnabled(tenantId, flagKey, fallback = false) {
  try {
    const [[row]] = await pool.query(
      'SELECT enabled FROM tenant_feature_flags WHERE tenant_id=? AND flag_key=? LIMIT 1',
      [tenantId || DEFAULT_TENANT, flagKey]
    );
    return row ? !!row.enabled : fallback;
  } catch (e) { logger.warn('[tenantPlan] flag read failed', { flagKey, err: e.message }); return fallback; }
}

async function getPlan(tenantId) {
  try {
    const [[row]] = await pool.query('SELECT * FROM tenant_plans WHERE tenant_id=? LIMIT 1', [tenantId || DEFAULT_TENANT]);
    return row || null;
  } catch (e) { logger.warn('[tenantPlan] plan read failed', { err: e.message }); return null; }
}

// Returns { ok, limit, current } — ok=false means the tenant is at/over the cap.
async function checkLimit(tenantId, limitField, countSql, countParams = []) {
  const plan = await getPlan(tenantId);
  const limit = plan ? Number(plan[limitField]) : Infinity;
  if (!Number.isFinite(limit)) return { ok: true, limit: null, current: null };
  try {
    const [[{ n }]] = await pool.query(countSql, countParams);
    return { ok: Number(n) < limit, limit, current: Number(n) };
  } catch (e) { logger.warn('[tenantPlan] limit count failed', { err: e.message }); return { ok: true, limit, current: null }; }
}

// Fire-and-forget usage record (never throws into the request path).
function recordUsage(tenantId, metric, amount = 1) {
  pool.query('INSERT INTO tenant_usage (tenant_id, metric, amount) VALUES (?,?,?)',
    [tenantId || DEFAULT_TENANT, metric, amount])
    .catch((e) => logger.warn('[tenantPlan] usage record failed', { metric, err: e.message }));
}

module.exports = { isFeatureEnabled, getPlan, checkLimit, recordUsage };
