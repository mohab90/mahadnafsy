'use strict';

/**
 * «نضيف لحساب مدير الدقي نظام الموارد البشريه ولكن فقط علي موظفين الدقي يقدر
 * ينشأ حساب ويقدر يشوف الاذونات والغيابات وكل ما يخص الموارد البشرية ولكن علي
 * نطاق الدقي» (9 Oct 2026).
 *
 * A branch manager reaches the HR of their branch's staff: the branch's own roles,
 * and anyone filed under the branch (branch_id — not reliable alone: the Dokki
 * reception on production is filed under branch-other). Only the routes that apply
 * this reach let them in — the staff list, a new account for the branch, leaves and
 * permissions, attendance and absences. Pay, advances and the rest of HR stay with
 * whoever holds view_hr / manage_hr.
 */

const { hasPermission } = require('../constants/permissions');

const BRANCH_HR = Object.freeze({
  DAQQI_MANAGER: { branch: 'DAQQI', branchId: 'branch-daqqi', roles: ['RECEPTION_DAQQI', 'DAQQI_MANAGER'], newRoles: ['RECEPTION_DAQQI'] },
  TAGAMOA_MANAGER: { branch: 'TAGAMOA', branchId: 'branch-tagamoa', roles: ['RECEPTION_TAGAMOA', 'TAGAMOA_MANAGER'], newRoles: ['RECEPTION_TAGAMOA'] },
});

/**
 * Whose HR this caller reaches: all of it, one branch's, or none (null). A
 * branch manager reaches their branch's, even when their grid also holds view_hr
 * — ticking the HR boxes «to open the permissions» used to hand the Dokki
 * manager every employee of the institute.
 */
function hrReach(req, level = 'view') {
  if (req.isSuperAdmin) return { all: true };
  const branch = BRANCH_HR[String(req.staffRecord?.role || '').toUpperCase()];
  if (branch) return { all: false, ...branch };
  if (hasPermission(req.staffRecord, level === 'manage' ? 'manage_hr' : 'view_hr')) return { all: true };
  return null;
}

/** Guard for a route a branch manager may use too; sets req.hrReach. */
const requireHr = level => (req, res, next) => {
  const reach = hrReach(req, level);
  if (!reach) return res.status(403).json({ error: 'Insufficient permissions', required: level === 'manage' ? 'manage_hr' : 'view_hr' });
  req.hrReach = reach;
  next();
};

/** ` AND (...)` narrowing a staff alias to the reach; empty for all of HR. */
function staffReachSql(reach, alias = 's') {
  if (!reach || reach.all) return { sql: '', params: [] };
  return { sql: ` AND (${alias}.role IN (${reach.roles.map(() => '?').join(',')}) OR ${alias}.branch_id = ?)`, params: [...reach.roles, reach.branchId] };
}

/** Is this employee within the caller's reach? */
async function staffInReach(db, req, staffId) {
  const reach = req.hrReach || hrReach(req);
  if (!reach) return false;
  if (reach.all) return true;
  const scope = staffReachSql(reach, 's');
  const [[row]] = await db.query(`SELECT s.id FROM staff s WHERE s.id = ? AND s.tenant_id = ?${scope.sql} LIMIT 1`, [staffId, req.tenantId, ...scope.params]);
  return Boolean(row);
}

const outOfReach = res => res.status(404).json({ error: 'الموظف ده مش من موظفين فرعك' });

module.exports = { BRANCH_HR, hrReach, outOfReach, requireHr, staffInReach, staffReachSql };
