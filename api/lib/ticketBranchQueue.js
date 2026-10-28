'use strict';
/**
 * A branch's own complaints queue — Dokki, Tagamoa, and any physical branch
 * added to lib/physicalBranches.js.
 *
 * Every client problem went to the central customer-service queue, so a Dokki
 * client's complaint about their round was answered by somebody who had never
 * seen the branch, while the branch's own desk — who could fix it — never heard
 * of it. A ticket's branch is its client's branch (routes/support.js
 * createRoutedTicket). When that is a physical branch and the problem is one
 * customer service or the administration would take (not billing, refunds,
 * sales or HR, which keep their teams), it goes to that branch's queue: the
 * department is the branch's (DEPARTMENT_ROLES in lib/ticketRouting.js), it is
 * handed in turn to the branch's staff who hold the inbox permission, and the
 * branch's managers are told. Escalation to the administration is as it was.
 *
 * Online clients, and a branch with nobody who can open a ticket, stay in the
 * central queue — a ticket nobody can read is worse than one at the centre.
 */

const { PHYSICAL_BRANCHES, isPhysicalBranch, normalizePhysicalBranch, boundBranchOf } = require('./physicalBranches');
const { CATEGORY_META, pickAssignee } = require('./ticketRouting');
const { branchIdForBranch } = require('./branches');

// The kinds of problem a branch's desk takes: what goes to customer service, and complaints.
const BRANCH_QUEUE_CATEGORIES = Object.freeze(Object.entries(CATEGORY_META)
  .filter(([category, meta]) => meta.department === 'support' || category === 'complaint')
  .map(([category]) => category));

const branchDepartment = branch => String(branch).toLowerCase();
const DEPARTMENT_BRANCH = Object.freeze(Object.fromEntries(Object.keys(PHYSICAL_BRANCHES).map(key => [branchDepartment(key), key])));
const CENTRAL_ROLES = new Set(['admin', 'manager', 'super_admin']);

/** The physical branch whose queue this ticket belongs in, or null for the central one. */
function branchQueueOf({ branch, category }) {
  const key = branch ? normalizePhysicalBranch(branch, null) : null;
  if (!key || !isPhysicalBranch(key)) return null;
  return BRANCH_QUEUE_CATEGORIES.includes(category) ? key : null;
}

/** Whether a staff member works at this branch: its roles, a data scope of it, or filed under it. */
function worksAtBranch(staff, branch) {
  if (!staff || !branch) return false;
  if (boundBranchOf(staff) === branch) return true;
  return staff.branch_id === branchIdForBranch(branch) && !CENTRAL_ROLES.has(String(staff.role || '').toLowerCase());
}

/** The branch a staff member's ticket queue is, or null. */
function staffBranch(staff) {
  const bound = boundBranchOf(staff);
  if (bound) return bound;
  const filed = Object.keys(PHYSICAL_BRANCHES).find(key => staff?.branch_id === branchIdForBranch(key));
  return filed && !CENTRAL_ROLES.has(String(staff?.role || '').toLowerCase()) ? filed : null;
}

function branchStaffClause(branch) {
  const meta = PHYSICAL_BRANCHES[branch];
  return {
    sql: '(UPPER(TRIM(s.role)) IN (?,?) OR s.data_scope=? OR s.branch_id=?)',
    params: [meta.managerRole, meta.receptionRole, `branch:${branch}`, branchIdForBranch(branch)],
  };
}

/**
 * Where a branch ticket goes: { department, branch, assignee, managers }, or null
 * when nobody at the branch can open a ticket (it stays central).
 */
async function routeToBranch(conn, { tenantId, branch }) {
  const clause = branchStaffClause(branch);
  const [staff] = await conn.query(
    `SELECT s.id, s.name, s.role, s.permissions_json, s.data_scope, s.branch_id
       FROM staff s WHERE s.tenant_id=? AND s.is_active=1 AND s.deleted_at IS NULL AND ${clause.sql}`,
    [tenantId, ...clause.params]
  );
  const { hasPermission } = require('../constants/permissions');
  const team = staff.filter(row => worksAtBranch(row, branch));
  if (!team.some(row => hasPermission(row, 'manage_inbox'))) return null;
  const assignee = await pickAssignee(conn, tenantId, branchDepartment(branch), {
    staffClause: clause, accept: row => worksAtBranch(row, branch),
  });
  const managerRole = PHYSICAL_BRANCHES[branch].managerRole;
  const managers = team.filter(row => String(row.role || '').toUpperCase() === managerRole);
  return { department: branchDepartment(branch), branch, assignee, managers };
}

module.exports = {
  BRANCH_QUEUE_CATEGORIES, DEPARTMENT_BRANCH, branchDepartment, branchQueueOf, worksAtBranch, staffBranch, routeToBranch,
};
