'use strict';

/**
 * The institute's physical branches — Dokki, and Tagamoa beside it.
 *
 * «خلي في قسم لفرع التجمع زي بتاع الدقي بالظبط في كل التفاصيل». The Dokki
 * section (rounds, attendance, housing, its desk and its manager) is not
 * copied for Tagamoa: it takes the branch as a parameter. Each round carries
 * its branch (daqqi_rounds.branch); a branch's own staff — its manager and its
 * reception — see and touch only their branch; everyone else whose role
 * reaches the section sees both.
 */

const PHYSICAL_BRANCHES = Object.freeze({
  DAQQI: Object.freeze({ key: 'DAQQI', label: 'الدقي', managerRole: 'DAQQI_MANAGER', receptionRole: 'RECEPTION_DAQQI' }),
  TAGAMOA: Object.freeze({ key: 'TAGAMOA', label: 'التجمع', managerRole: 'TAGAMOA_MANAGER', receptionRole: 'RECEPTION_TAGAMOA' }),
});
const PHYSICAL_BRANCH_KEYS = Object.freeze(Object.keys(PHYSICAL_BRANCHES));

const ROLE_BRANCH = Object.freeze(Object.fromEntries(Object.values(PHYSICAL_BRANCHES)
  .flatMap(branch => [[branch.managerRole, branch.key], [branch.receptionRole, branch.key]])));

/** Every branch-bound role, upper case: DAQQI_MANAGER, RECEPTION_DAQQI, TAGAMOA_MANAGER, … */
const BRANCH_ROLES = Object.freeze(Object.keys(ROLE_BRANCH));
const MANAGER_ROLES = Object.freeze(Object.values(PHYSICAL_BRANCHES).map(branch => branch.managerRole));
const RECEPTION_ROLES = Object.freeze(Object.values(PHYSICAL_BRANCHES).map(branch => branch.receptionRole));

const isPhysicalBranch = value => PHYSICAL_BRANCH_KEYS.includes(String(value || '').toUpperCase());

/** A physical branch key from free input, or the fallback. */
function normalizePhysicalBranch(value, fallback = 'DAQQI') {
  const key = String(value || '').trim().toUpperCase().replace(/[-\s]+/g, '_');
  if (key === 'DQI' || key === 'DOKKI') return 'DAQQI';
  return isPhysicalBranch(key) ? key : fallback;
}

/**
 * The one physical branch a staff member is confined to, or null when their
 * role reaches every branch (admin, manager, support, accounts…). A branch
 * role binds by itself; any other role binds through a data scope of
 * exactly one physical branch.
 */
function boundBranchOf(staffRecord) {
  if (!staffRecord) return null;
  const role = String(staffRecord.role || '').toUpperCase();
  if (ROLE_BRANCH[role]) return ROLE_BRANCH[role];
  const scope = String(staffRecord.data_scope || '').trim();
  const match = scope.match(/^branch:([A-Z_]+)$/i);
  return match && isPhysicalBranch(match[1]) ? match[1].toUpperCase() : null;
}

/** The branch a request is confined to (null: all of them). */
const boundBranch = req => (req.isSuperAdmin ? null : boundBranchOf(req.staffRecord));

/** Whether this request may see or change something at `branch`. */
function canTouchBranch(req, branch) {
  const bound = boundBranch(req);
  return !bound || bound === normalizePhysicalBranch(branch);
}

/**
 * The branch to act on: the one asked for (query/body `branch`), else the
 * staff member's own, else Dokki. A branch-bound account asking for another
 * branch is told no rather than quietly served its own.
 */
function requestedBranch(req) {
  const asked = req.query?.branch || req.body?.branch || req.body?.physicalBranch || null;
  const bound = boundBranch(req);
  const branch = asked ? normalizePhysicalBranch(asked, null) : (bound || 'DAQQI');
  if (!branch) throw Object.assign(new Error('Unknown branch'), { statusCode: 400 });
  if (bound && bound !== branch) throw Object.assign(new Error('الفرع ده مش من صلاحياتك'), { statusCode: 403 });
  return branch;
}

/** SQL narrowing a daqqi_rounds query to what this request may see. */
function roundsScopeSql(req, alias = '') {
  const bound = boundBranch(req);
  const column = alias ? `${alias}.branch` : 'branch';
  return bound ? { sql: ` AND ${column}=?`, params: [bound] } : { sql: '', params: [] };
}

module.exports = {
  PHYSICAL_BRANCHES,
  PHYSICAL_BRANCH_KEYS,
  BRANCH_ROLES,
  MANAGER_ROLES,
  RECEPTION_ROLES,
  isPhysicalBranch,
  normalizePhysicalBranch,
  boundBranchOf,
  boundBranch,
  canTouchBranch,
  requestedBranch,
  roundsScopeSql,
};
