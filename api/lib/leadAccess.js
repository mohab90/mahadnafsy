'use strict';

const { DATA_SCOPE } = require('../constants/permissions');

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
    return { scope, sql: ` AND ${alias}.branch=?`, params: [scope.slice(7)], none: false };
  }
  return { scope: 'all', sql: '', params: [], none: false };
}

module.exports = { leadScope };
