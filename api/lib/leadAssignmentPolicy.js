'use strict';

const { pool } = require('./db');
const { uuidv4 } = require('./id');

function normalizeBranch(value) {
  return String(value || '*').trim().toUpperCase().replace(/[-\s]/g, '_') || '*';
}

async function listAssignmentMembers(tenantId, db = pool) {
  const [rows] = await db.query(
    `SELECT p.id,p.staff_id AS staffId,s.name AS staffName,p.branch_key AS branchKey,
            p.team_key AS teamKey,p.weight,p.max_open_leads AS maxOpenLeads,
            p.is_available AS isAvailable,p.last_assigned_at AS lastAssignedAt
       FROM crm_assignment_members p
       JOIN staff s ON s.id=p.staff_id AND s.tenant_id=p.tenant_id
      WHERE p.tenant_id=? ORDER BY p.team_key,p.branch_key,s.name`,
    [tenantId]
  );
  return rows.map(row => ({
    ...row,
    weight: Number(row.weight || 1),
    maxOpenLeads: row.maxOpenLeads == null ? null : Number(row.maxOpenLeads),
    isAvailable: Boolean(row.isAvailable),
  }));
}

async function saveAssignmentMembers(tenantId, members, db = pool) {
  if (!Array.isArray(members)) {
    const error = new Error('Assignment members are required'); error.statusCode = 400; throw error;
  }
  for (const member of members) {
    const staffId = String(member.staffId || '');
    const branchKey = normalizeBranch(member.branchKey);
    const teamKey = String(member.teamKey || 'sales').trim().toLowerCase().slice(0, 64);
    const weight = Math.min(Math.max(Number(member.weight) || 1, 0.1), 100);
    const maxOpenLeads = member.maxOpenLeads === '' || member.maxOpenLeads == null
      ? null : Math.min(Math.max(Number(member.maxOpenLeads) || 0, 0), 100000);
    const [[staff]] = await db.query(
      `SELECT id FROM staff WHERE tenant_id=? AND id=? AND UPPER(role)='SALES'
       AND is_active=1 AND deleted_at IS NULL LIMIT 1`,
      [tenantId, staffId]
    );
    if (!staff) {
      const error = new Error('Active sales staff not found'); error.statusCode = 409; throw error;
    }
    await db.query(
      `INSERT INTO crm_assignment_members
       (id,tenant_id,staff_id,branch_key,team_key,weight,max_open_leads,is_available)
       VALUES (?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE weight=VALUES(weight),max_open_leads=VALUES(max_open_leads),
         is_available=VALUES(is_available)`,
      [member.id || uuidv4(), tenantId, staffId, branchKey, teamKey, weight, maxOpenLeads,
        member.isAvailable === false ? 0 : 1]
    );
  }
  return listAssignmentMembers(tenantId, db);
}

module.exports = { listAssignmentMembers, normalizeBranch, saveAssignmentMembers };
