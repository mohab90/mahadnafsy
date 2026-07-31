'use strict';

const { DATA_SCOPE } = require('../constants/permissions');

// A branch scope may name one branch ('branch:DAQQI') or several
// ('branch:ONLINE_EGYPT,ONLINE_SAUDI'). Roles that oversee a group of branches —
// an online manager covering the three online branches — cannot be expressed
// with a single value, and the alternative was giving them 'all', which also
// exposes other branches' data.
function branchesFromScope(scope) {
  return String(scope).slice(7).split(',').map(b => b.trim()).filter(Boolean);
}

function leadScope({ tenantId, staffRecord, isSuperAdmin }, alias = 'l') {
  if (!staffRecord || isSuperAdmin) return { scope: 'all', sql: '', params: [], none: false };
  const scope = DATA_SCOPE[String(staffRecord.role || '').toLowerCase()] || 'assigned_sales';
  if (scope === 'none') return { scope, sql: ' AND 1=0', params: [], none: true };
  if (scope === 'assigned_sales') {
    return { scope, sql: ` AND ${alias}.assigned_sales_id=?`, params: [staffRecord.id], none: false };
  }
  if (scope === 'assigned_cs') {
    return {
      scope,
      sql: ` AND ${alias}.id IN (SELECT lead_id FROM subscribers WHERE tenant_id=? AND assigned_cs_id=? AND lead_id IS NOT NULL)`,
      params: [tenantId, staffRecord.id],
      none: false,
    };
  }
  if (scope.startsWith('branch:')) {
    const branches = branchesFromScope(scope);
    if (!branches.length) return { scope, sql: ' AND 1=0', params: [], none: true };
    return {
      scope,
      sql: ` AND ${alias}.branch IN (${branches.map(() => '?').join(',')})`,
      params: branches,
      none: false,
    };
  }
  return { scope: 'all', sql: '', params: [], none: false };
}

module.exports = { leadScope, branchesFromScope };
