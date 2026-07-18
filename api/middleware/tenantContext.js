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
 * Fail-closed by design: requests without an explicit tenant use the canonical
 * default institute, while unknown, suspended, or unavailable tenant lookups
 * are rejected rather than silently falling back to another tenant.
 */
const logger = require('../lib/logger');
const jwt = require('jsonwebtoken');
const net = require('net');
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
 * query. Returns an empty index if the table is missing; explicit candidates
 * will consequently be rejected as unknown.
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
  const userTenantId = req.user && (req.user.tid || req.user.tenant_id);
  if (userTenantId) return { value: String(userTenantId), source: 'jwt' };
  // 2) explicit header (internal/admin tools)
  if (req.headers['x-tenant-id']) return { value: String(req.headers['x-tenant-id']), source: 'header' };
  // 1) sub-domain  (acme.mahad.app → "acme")
  const host = (req.headers.host || '').split(':')[0];
  if (net.isIP(host)) return null;
  const labels = host.split('.');
  const sub = (labels[0] || '').toLowerCase();
  if (sub && labels.length > 2 && !RESERVED_SUBS.has(sub)) return { value: sub, source: 'subdomain' };
  return null;
}

// tenantContext is mounted before route-level requireAuth. Decode only a valid,
// signed token here so the tenant claim is available without granting access.
// Authorization remains the responsibility of requireAuth/optionalAuth.
function extractSignedTenant(req) {
  let token = null;
  const cookieMatch = String(req.headers.cookie || '').match(/(?:^|;\s*)authToken=([^;]+)/);
  if (cookieMatch) token = decodeURIComponent(cookieMatch[1]);
  if (!token) {
    const header = String(req.headers.authorization || '');
    if (header.startsWith('Bearer ')) token = header.slice(7);
  }
  if (!token) return null;
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) return null;
  try {
    const payload = jwt.verify(token, jwtSecret);
    const tenantId = payload.tid || payload.tenant_id;
    // A valid legacy token without tid belongs to the original/default
    // institute. Do not let an untrusted header move that session elsewhere.
    return tenantId ? String(tenantId) : DEFAULT_TENANT;
  } catch (_) {
    return null;
  }
}

async function resolveTenant(req, res, next) {
  try {
    const signedTenant = extractSignedTenant(req);
    // Preserve legacy single-institute deployments: a valid old token is
    // confined to default and does not depend on the tenants table existing.
    if (signedTenant === DEFAULT_TENANT) {
      req.tenantId = DEFAULT_TENANT;
      return next();
    }
    const candidate = signedTenant
      ? { value: signedTenant, source: 'jwt' }
      : extractCandidate(req);
    if (!candidate) { req.tenantId = DEFAULT_TENANT; return next(); }

    const index = await loadTenantIndex();
    const key = candidate.value.toLowerCase();
    const match = index.byId[candidate.value] || index.bySlug[key];

    if (!match) return res.status(400).json({ error: 'Unknown tenant', code: 'TENANT_UNKNOWN' });
    if (match.status !== 'active') {
      return res.status(403).json({ error: 'هذا الحساب موقوف مؤقتًا. تواصل مع الإدارة.', code: 'TENANT_SUSPENDED' });
    }
    req.tenantId = match.id;
    req.tenant = match;
    next();
  } catch (e) {
    logger.error('[tenantContext] resolve failed:', e.message);
    res.status(503).json({ error: 'Tenant resolution unavailable', code: 'TENANT_RESOLUTION_FAILED' });
  }
}

module.exports = { resolveTenant, DEFAULT_TENANT, loadTenantIndex, extractCandidate, extractSignedTenant };
