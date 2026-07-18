'use strict';

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || 'tenant-default';

function normalizeTenantId(value) {
  return String(value || '').trim();
}

function tenantIdFromPayload(payload) {
  return normalizeTenantId(payload?.tid || payload?.tenant_id) || DEFAULT_TENANT_ID;
}

// req.tenantId is canonicalised by tenantContext before auth runs. A signed
// token is never allowed to cross that boundary; old tokens without a tenant
// claim remain confined to the canonical default tenant.
function getTrustedTenantId(req, signedTenantId = req.user?.tenant_id) {
  const requestTenantId = normalizeTenantId(req.tenantId);
  const userTenantId = normalizeTenantId(signedTenantId) || DEFAULT_TENANT_ID;
  if (requestTenantId && requestTenantId !== userTenantId) return null;
  return requestTenantId || userTenantId;
}

async function findActiveStaff(req, email, { includePermissions = false, query } = {}) {
  if (typeof query !== 'function') throw new TypeError('findActiveStaff requires a query function');
  const tenantId = getTrustedTenantId(req);
  if (!tenantId || !String(email || '').trim()) return null;
  const fields = includePermissions ? 'id, role, permissions_json, tenant_id' : 'id, role, tenant_id';
  const [[staff]] = await query(
    `SELECT ${fields} FROM staff
     WHERE tenant_id = ?
       AND LOWER(TRIM(email)) COLLATE utf8mb4_unicode_ci = ?
       AND is_active = 1
     LIMIT 1`,
    [tenantId, String(email).toLowerCase().trim()],
  );
  return staff || null;
}

module.exports = {
  DEFAULT_TENANT_ID,
  findActiveStaff,
  getTrustedTenantId,
  tenantIdFromPayload,
};
