'use strict';

const { resolveDataScope } = require('../constants/permissions');

// A branch scope may name one branch ('branch:DAQQI') or several
// ('branch:ONLINE_EGYPT,ONLINE_SAUDI'). Roles that oversee a group of branches —
// an online manager covering the three online branches — cannot be expressed
// with a single value, and the alternative was giving them 'all', which also
// exposes other branches' data.
function branchesFromScope(scope) {
  return String(scope).slice(7).split(',').map(b => b.trim()).filter(Boolean);
}

// The Dokki desk's leads are the ones handed to the Dokki team: «الليدات
// المعينه لفريق الدقي فقط». Its branch scope listed every lead tagged DAQQI —
// 5,887 on 30 Sep 2026, every one of them a sales rep's.
const DAQQI_TEAM_ROLES = ['daqqi_manager', 'reception_daqqi'];
const DAQQI_TEAM_IDS = `SELECT id FROM staff WHERE tenant_id=? AND LOWER(role) IN ('daqqi_manager','reception_daqqi')`;

function leadScope({ tenantId, staffRecord, isSuperAdmin }, alias = 'l') {
  if (!staffRecord || isSuperAdmin) return { scope: 'all', sql: '', params: [], none: false };
  const scope = resolveDataScope(staffRecord, { fallback: 'assigned_sales' });
  if (scope === 'none') return { scope, sql: ' AND 1=0', params: [], none: true };
  if (scope === 'assigned_sales') {
    return { scope, sql: ` AND ${alias}.assigned_sales_id=?`, params: [staffRecord.id], none: false };
  }
  // A collection officer's leads: the ones handed to them from the remaining
  // data (leads.assigned_cs_id — «اوزعلهم من الداتا المتبقية») and the lead
  // behind every client they collect from. It was the second alone, so data
  // distributed to the collection team reached nobody's screen.
  if (scope === 'assigned_cs') {
    return {
      scope,
      sql: ` AND (${alias}.assigned_cs_id=? OR ${alias}.id IN (SELECT lead_id FROM subscribers WHERE tenant_id=? AND assigned_cs_id=? AND lead_id IS NOT NULL))`,
      params: [staffRecord.id, tenantId, staffRecord.id],
      none: false,
    };
  }
  if (scope === 'branch:DAQQI' && DAQQI_TEAM_ROLES.includes(String(staffRecord.role || '').toLowerCase())) {
    return {
      scope,
      sql: ` AND (${alias}.assigned_sales_id IN (${DAQQI_TEAM_IDS}) OR ${alias}.assigned_cs_id IN (${DAQQI_TEAM_IDS}))`,
      params: [tenantId, tenantId],
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

module.exports = { leadScope, branchesFromScope, DAQQI_TEAM_ROLES };
