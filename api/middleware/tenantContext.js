'use strict';
/**
 * Tenant-context resolver (multi-tenancy FOUNDATION — Critical Issue #2).
 *
 * Today Mahad is SINGLE-TENANT (one institute). This middleware is the seam where
 * multi-tenancy plugs in later: it resolves a tenant id from (in priority order)
 * sub-domain, X-Tenant-Id header, or JWT claim, and exposes it as req.tenantId.
 * In single-tenant mode it always yields DEFAULT_TENANT, so wiring it now is a
 * no-op — but every handler can already read req.tenantId, easing the future
 * migration (add tenant_id column + scope each query by req.tenantId).
 *
 * NOT yet mounted globally. Mount in server.js once the DB carries tenant_id.
 * See docs/MULTI-TENANCY.md for the full rollout plan.
 */
// Canonical tenant id 'tenant-default' — matches the prod DB (every row's
// tenant_id is already 'tenant-default'). Aligned with lib/tenantScope.js.
const DEFAULT_TENANT = process.env.DEFAULT_TENANT_ID || 'tenant-default';

function resolveTenant(req, _res, next) {
  let tenant = DEFAULT_TENANT;
  // 1) sub-domain  (acme.mahad.app → "acme")
  const host = (req.headers.host || '').split(':')[0];
  const sub = host.split('.')[0];
  if (sub && sub !== 'www' && sub !== 'mahad' && host.split('.').length > 2) tenant = sub;
  // 2) explicit header (internal/admin tools)
  if (req.headers['x-tenant-id']) tenant = String(req.headers['x-tenant-id']);
  // 3) JWT claim (set during auth when multi-tenant)
  if (req.user && req.user.tid) tenant = String(req.user.tid);

  req.tenantId = tenant;
  next();
}

module.exports = { resolveTenant, DEFAULT_TENANT };
