'use strict';

const { DEFAULT_TENANT_ID, resolveTenantId } = require('./tenantScope');

function scopedTenantId(req) {
  return req.tenantId || resolveTenantId(req) || DEFAULT_TENANT_ID;
}

function tenantWhere(alias, tenantId, params) {
  const col = alias ? `${alias}.tenant_id` : 'tenant_id';
  const effectiveTenantId = tenantId || DEFAULT_TENANT_ID;
  params.push(effectiveTenantId);
  if (effectiveTenantId === DEFAULT_TENANT_ID) {
    return `(${col} = ? OR ${col} IS NULL OR ${col} = '')`;
  }
  return `${col} = ?`;
}

async function findSubscriberForUser(pool, req) {
  const uid = String(req.user?.uid || '').trim();
  const email = String(req.user?.email || '').trim().toLowerCase();
  const tenantId = scopedTenantId(req);
  const params = [];
  const scope = tenantWhere('s', tenantId, params);
  const [[sub]] = await pool.query(
    `SELECT s.id, s.tenant_id, s.branch, s.branch_id, s.name, s.email, s.phone, s.firebase_uid
     FROM subscribers s
     WHERE ${scope}
       AND (
         (? <> '' AND s.firebase_uid = ?)
         OR (? <> '' AND s.id = ?)
         OR (? <> '' AND LOWER(TRIM(s.email)) = ?)
       )
     LIMIT 1`,
    [...params, uid, uid, uid, uid, email, email],
  );
  return sub || null;
}

module.exports = {
  scopedTenantId,
  tenantWhere,
  findSubscriberForUser,
};
