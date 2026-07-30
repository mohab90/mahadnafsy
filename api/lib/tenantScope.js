'use strict';

const { pool } = require('./db');
const logger = require('./logger').child({ module: 'tenant-scope' });

// The canonical tenant id is 'tenant-default' — that is what the PROD DB already
// carries (a prior SaaS migration set every row's tenant_id to 'tenant-default';
// tenants/branches all use it). req.tenantId MUST equal it or scoped queries
// return 0 rows. Both this and middleware/tenantContext.js default to it.
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || 'tenant-default';
const DEFAULT_FEATURES = Object.freeze({
  finance: true,
  payments: true,
  leads: true,
  client_portal: true,
  lms: true,
  branch_workspaces: true,
  hr: true,
  marketing: true,
  support: true,
  daqqi: true,
  settings: true,
  security: true,
  analytics: true,
});

const CACHE_TTL_MS = Number(process.env.MAHAD_TENANT_CONTEXT_CACHE_MS || 30000);
const cache = new Map();

function tryJson(value, fallback) {
  try {
    if (!value) return fallback;
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch (_) {
    return fallback;
  }
}

function resolveTenantId(req) {
  // tenantContext validates header/sub-domain candidates and writes the
  // canonical id to req.tenantId. Never consume x-tenant-id directly here.
  return String(req.tenantId || req.user?.tenant_id || DEFAULT_TENANT_ID).trim() || DEFAULT_TENANT_ID;
}

async function loadTenantContext(tenantId = DEFAULT_TENANT_ID) {
  const key = tenantId || DEFAULT_TENANT_ID;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.value;

  const [[tenant]] = await pool.query(
    'SELECT id, slug, name, status, plan_key FROM tenants WHERE id=? LIMIT 1',
    [key],
  );

  const [[subscription]] = await pool.query(`
    SELECT ts.id, ts.status, ts.starts_at, ts.ends_at, ts.trial_ends_at,
           sp.plan_key, sp.name AS plan_name, sp.feature_limits_json
    FROM tenant_subscriptions ts
    LEFT JOIN saas_plans sp ON sp.id = ts.plan_id
    WHERE ts.tenant_id=?
    ORDER BY FIELD(ts.status,'active','trialing','past_due','expired','cancelled'), ts.created_at DESC
    LIMIT 1
  `, [key]);

  const [flagRows] = await pool.query(
    `SELECT flag_key, is_enabled, config_json
     FROM feature_flags
     WHERE tenant_id=? OR tenant_id IS NULL
     ORDER BY tenant_id IS NOT NULL ASC`,
    [key],
  );

  const planLimits = tryJson(subscription?.feature_limits_json, {});
  const explicitPlanFeatures = planLimits.features && typeof planLimits.features === 'object'
    ? planLimits.features
    : null;
  const features = {
    ...(explicitPlanFeatures
      ? Object.fromEntries(Object.keys(DEFAULT_FEATURES).map(feature => [feature, false]))
      : DEFAULT_FEATURES),
    ...(explicitPlanFeatures || {}),
  };
  const featureConfig = {};
  for (const row of flagRows) {
    if (Object.prototype.hasOwnProperty.call(DEFAULT_FEATURES, row.flag_key)) {
      features[row.flag_key] = !!row.is_enabled;
    }
    featureConfig[row.flag_key] = tryJson(row.config_json, {});
  }

  const now = Date.now();
  const startsAt = subscription?.starts_at ? new Date(subscription.starts_at).getTime() : null;
  const entitlementEnd = subscription?.status === 'trialing'
    ? subscription?.trial_ends_at
    : subscription?.ends_at;
  const endsAt = entitlementEnd ? new Date(entitlementEnd).getTime() : null;
  const entitlementIsCurrent = Boolean(
    subscription
    && ['active', 'trialing'].includes(subscription.status)
    && (!startsAt || startsAt <= now)
    && (!endsAt || endsAt >= now)
  );
  const value = {
    tenantId: key,
    tenant: tenant || { id: key, status: 'unknown' },
    subscription: subscription || null,
    planLimits,
    features,
    featureConfig,
    isActive: tenant?.status === 'active' && entitlementIsCurrent,
  };
  cache.set(key, { ts: Date.now(), value });
  return value;
}

function clearTenantContextCache(tenantId) {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

function requireTenantFeature(featureKey) {
  return async function tenantFeatureGuard(req, res, next) {
    try {
      const tenantId = resolveTenantId(req);
      const context = await loadTenantContext(tenantId);
      req.tenantContext = context;
      req.tenantId = tenantId;
      if (!context.isActive) return res.status(402).json({ error: 'Tenant subscription is not active', tenant_id: tenantId });
      if (context.features[featureKey] === false) {
        return res.status(403).json({
          error: 'Feature disabled for tenant plan',
          code: 'PLAN_FEATURE_DISABLED',
          feature: featureKey,
          tenant_id: tenantId,
        });
      }
      next();
    } catch (error) {
      logger.error('tenant feature guard failed', error);
      res.status(500).json({ error: 'Tenant feature check failed' });
    }
  };
}

module.exports = {
  DEFAULT_FEATURES,
  DEFAULT_TENANT_ID,
  clearTenantContextCache,
  loadTenantContext,
  requireTenantFeature,
  resolveTenantId,
};
