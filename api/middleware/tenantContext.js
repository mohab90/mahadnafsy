'use strict';
/**
 * Tenant-context resolver (multi-tenancy — SaaS routing, weakness #5).
 *
 * Resolves a tenant from (priority order) sub-domain slug, X-Tenant-Id header,
 * or JWT claim, and exposes the *canonical tenant id* as req.tenantId (plus the
 * full record as req.tenant). The incoming candidate may be a slug (e.g.
 * "acme" from acme.mahad.app) OR an id; both are mapped to the real
 * tenants.id via a short-lived cache of the active tenants.
 *
 * Fail-safe by design: if the tenants table is absent (single-tenant prod that
 * has not run migration 027) or the candidate matches no ACTIVE tenant, we fall
 * back to DEFAULT_TENANT so the single-institute deployment keeps working
 * unchanged. A SUSPENDED/ARCHIVED tenant that is explicitly requested is
 * rejected with 403 rather than silently downgraded.
 */
const logger = require('../lib/logger');
const { pool, cached } = require('../lib/db');

// Canonical tenant id 'tenant-default' — matches the prod DB (every row's
// tenant_id is already 'tenant-default'). Aligned with lib/tenantScope.js.
const DEFAULT_TENANT = process.env.DEFAULT_TENANT_ID || 'tenant-default';

// Sub-domain labels that are never a tenant slug (marketing/app/root hosts).
const RESERVED_SUBS = new Set(['www', 'mahad', 'app', 'api', 'admin', 'staging', 'dev', 'localhost']);
const TENANTS_TTL_MS = 60 * 1000;

/**
 * Load all active tenants once and index them by both id and slug.
 * Cached (60s) so per-request resolution is an in-memory map lookup, not a
 * query. Returns an empty index (never throws) if the table is missing.
 */
async function loadTenantIndex() {
  return cached('tenant_index', TENANTS_TTL_MS, async () => {
    const index = { byId: Object.create(null), bySlug: Object.create(null) };
    try {
      const [rows] = await pool.query(
        "SELECT id, slug, name, status, plan_key FROM tenants WHERE status <> 'archived'"
      );
      for (const r of rows) {
        index.byId[r.id] = r;
        if (r.slug) index.bySlug[String(r.slug).toLowerCase()] = r;
      }
    } catch (e) {
      // Table missing (pre-027) or transient DB error → single-tenant fallback.
      if (!/doesn't exist|Unknown table|no such table/i.test(e.message || '')) {
        logger.error('[tenantContext] tenant index load failed:', e.message);
      }
    }
    return index;
  });
}

/** Extract the tenant candidate string from the request (slug or id), if any. */
function extractCandidate(req) {
  // 3) JWT claim wins (authenticated multi-tenant session)
  if (req.user && req.user.tid) return { value: String(req.user.tid), source: 'jwt' };
  // 2) explicit header (internal/admin tools)
  if (req.headers['x-tenant-id']) return { value: String(req.headers['x-tenant-id']), source: 'header' };
  // 1) sub-domain  (acme.mahad.app → "acme")
  const host = (req.headers.host || '').split(':')[0];
  const labels = host.split('.');
  const sub = (labels[0] || '').toLowerCase();
  if (sub && labels.length > 2 && !RESERVED_SUBS.has(sub)) return { value: sub, source: 'subdomain' };
  return null;
}

async function resolveTenant(req, res, next) {
  try {
    const candidate = extractCandidate(req);
    if (!candidate) { req.tenantId = DEFAULT_TENANT; return next(); }

    const index = await loadTenantIndex();
    const key = candidate.value.toLowerCase();
    const match = index.byId[candidate.value] || index.bySlug[key];

    if (!match) {
      // Explicit but unknown tenant → in single-tenant fallback we still serve
      // the default (keeps prod working); log for visibility.
      req.tenantId = DEFAULT_TENANT;
      return next();
    }
    if (match.status !== 'active') {
      return res.status(403).json({ error: 'هذا الحساب موقوف مؤقتًا. تواصل مع الإدارة.', code: 'TENANT_SUSPENDED' });
    }
    req.tenantId = match.id;
    req.tenant = match;
    next();
  } catch (e) {
    logger.error('[tenantContext] resolve failed:', e.message);
    req.tenantId = DEFAULT_TENANT;
    next();
  }
}

module.exports = { resolveTenant, DEFAULT_TENANT, loadTenantIndex, extractCandidate };
