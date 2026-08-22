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
  // Checked in one pass, before anything is written, and reported by name.
  //
  // This used to throw "Active sales staff not found" on the first bad row and
  // stop — no name, no id, no hint which of the six members it meant. The CRM
  // settings modal saves the sources, the pipeline and this list together, so a
  // member whose role changed to COLLECTION after they were added made saving
  // the *Google Sheets* configuration fail with a message about sales staff.
  // Whoever hit it had no way to know who to remove or which tab to look at.
  const invalid = [];
  for (const member of members) {
    const staffId = String(member.staffId || '');
    const [[row]] = await db.query(
      `SELECT id, name, role, is_active, deleted_at FROM staff
        WHERE tenant_id=? AND id=? LIMIT 1`,
      [tenantId, staffId]
    );
    // getNextSalesRep only ever picks staff whose role is SALES, so a member who
    // is anything else can never be handed a lead — keeping the row would be a
    // silent no-op rather than a working configuration.
    const usable = row && String(row.role || '').toUpperCase() === 'SALES'
      && Number(row.is_active) === 1 && !row.deleted_at;
    if (!usable) {
      const who = row?.name || member.staffName || staffId || '(بدون اسم)';
      invalid.push(!row ? `${who}: غير موجود`
        : row.deleted_at ? `${who}: محذوف`
          : Number(row.is_active) !== 1 ? `${who}: غير نشط`
            : `${who}: دوره ${row.role} وليس SALES`);
    }
  }
  if (invalid.length) {
    const error = new Error(
      `تعذّر حفظ توزيع العملاء المحتملين — الأعضاء دول مش ضمن فريق المبيعات النشط: ${invalid.join(' · ')}. `
      + 'شيلهم من تبويب «التوزيع» وجرّب تاني.'
    );
    error.statusCode = 409;
    throw error;
  }

  for (const member of members) {
    const staffId = String(member.staffId || '');
    const branchKey = normalizeBranch(member.branchKey);
    const teamKey = String(member.teamKey || 'sales').trim().toLowerCase().slice(0, 64);
    const weight = Math.min(Math.max(Number(member.weight) || 1, 0.1), 100);
    const maxOpenLeads = member.maxOpenLeads === '' || member.maxOpenLeads == null
      ? null : Math.min(Math.max(Number(member.maxOpenLeads) || 0, 0), 100000);
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
