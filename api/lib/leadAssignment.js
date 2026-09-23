'use strict';

const { pool } = require('./db');
const { logLeadEventStrict } = require('./crm');
const { findLeadById } = require('./leadRepository');
const { normalizeBranch } = require('./leadAssignmentPolicy');

// Who may receive leads automatically. The CRM settings "التوزيع" screen is
// the authority: once any rep has a row there, only reps with a row that is
// switched on (and under its cap) take part. A tenant that never saved that
// screen falls back to every active sales rep.
//
// Before this, every distributor read the staff table directly, so a rep hired
// after the screen was saved was invisible on it yet took part in every
// round-robin — and under "least loaded" got nearly everything, having zero
// open leads. New reps now appear on the screen switched off and receive
// nothing until someone turns them on.
async function listDistributableReps(tenantId, db = pool, options = {}) {
  const branch = options.branch ? normalizeBranch(options.branch) : null;
  const teamKey = String(options.teamKey || 'sales').trim().toLowerCase();
  const [rows] = await db.query(
    `SELECT s.id,s.name,p.id AS policy_id,p.branch_key,p.weight,p.max_open_leads,
            p.is_available,p.last_assigned_at
       FROM staff s
       LEFT JOIN crm_assignment_members p
         ON p.tenant_id=s.tenant_id AND p.staff_id=s.id AND p.team_key=?
      WHERE s.tenant_id=? AND s.is_active=1 AND s.deleted_at IS NULL AND UPPER(s.role)='SALES'
      ORDER BY s.name ASC`,
    [teamKey, tenantId]
  );
  const [loads] = await db.query(
    `SELECT assigned_sales_id,COUNT(*) active_leads FROM leads
      WHERE tenant_id=? AND hidden=0
        AND status NOT IN ('converted','lost','archived','disqualified')
        AND assigned_sales_id IS NOT NULL GROUP BY assigned_sales_id`,
    [tenantId]
  );
  const loadByStaff = new Map(loads.map(row => [String(row.assigned_sales_id), Number(row.active_leads)]));
  const configured = rows.some(row => row.policy_id != null);

  const staffById = new Map();
  for (const row of rows) {
    const entry = staffById.get(row.id) || { id: row.id, name: row.name, policies: [] };
    if (row.policy_id != null) entry.policies.push(row);
    staffById.set(row.id, entry);
  }

  const reps = [];
  for (const { id, name, policies } of staffById.values()) {
    const activeLeads = loadByStaff.get(String(id)) || 0;
    if (!configured) {
      reps.push({ id, name, policyId: null, weight: 1, maxOpenLeads: null, activeLeads, lastAssignedAt: null });
      continue;
    }
    const policy = branch
      ? (policies.find(p => p.branch_key === branch) || policies.find(p => p.branch_key === '*'))
      : (policies.find(p => p.branch_key === '*') || policies[0]);
    if (!policy || !policy.is_available) continue;
    const maxOpenLeads = policy.max_open_leads == null ? null : Number(policy.max_open_leads);
    if (maxOpenLeads != null && activeLeads >= maxOpenLeads) continue;
    reps.push({
      id, name, policyId: policy.policy_id,
      weight: Math.max(Number(policy.weight) || 1, 0.1),
      maxOpenLeads, activeLeads, lastAssignedAt: policy.last_assigned_at,
    });
  }
  return reps;
}

// Hands out reps one lead at a time for a batch (sheet sync, bulk distribution),
// keeping each rep's cap and load current as it goes.
//   mode 'rr'    — strict rotation, resumable from `start`
//   mode 'least' — lowest weighted open load first
function createRepRotation(reps, { mode = 'rr', start = 0 } = {}) {
  let index = Number(start) || 0;
  return {
    next() {
      const open = reps.filter(rep => rep.maxOpenLeads == null || rep.activeLeads < rep.maxOpenLeads);
      if (!open.length) return null;
      let rep;
      if (mode === 'least') {
        rep = [...open].sort((a, b) =>
          (a.activeLeads / a.weight) - (b.activeLeads / b.weight) || String(a.name).localeCompare(String(b.name)))[0];
      } else {
        rep = open[index % open.length];
        index += 1;
      }
      rep.activeLeads += 1;
      return rep;
    },
    get index() { return index; },
  };
}

// Canonical single-lead picker used at capture time (public registration,
// chatbot, self-registration, Facebook Lead Ads, WhatsApp/Messenger inbound).
// Load counts only leads still open, so a veteran's converted history does not
// make them look permanently "full".
async function getNextSalesRep(tenantId, db = pool, options = {}) {
  const reps = await listDistributableReps(tenantId, db, {
    branch: options.branch,
    teamKey: options.teamKey,
  });
  reps.sort((a, b) =>
    (a.activeLeads / a.weight) - (b.activeLeads / b.weight) ||
    new Date(a.lastAssignedAt || 0) - new Date(b.lastAssignedAt || 0) ||
    String(a.name).localeCompare(String(b.name))
  );
  const rep = reps[0] || null;
  if (rep?.policyId) {
    await db.query(
      'UPDATE crm_assignment_members SET last_assigned_at=NOW() WHERE id=? AND tenant_id=?',
      [rep.policyId, tenantId]
    );
  }
  return rep ? { id: rep.id, name: rep.name } : null;
}

async function assignLead({ tenantId, leadId, salesId, actor = null, reason = 'Lead assigned', metadata = {} }, db = null) {
  if (!tenantId || !leadId || !salesId) {
    const error = new Error('tenantId, leadId and salesId are required');
    error.statusCode = 400;
    throw error;
  }
  const ownsConnection = !db;
  const conn = db || await pool.getConnection();
  try {
    if (ownsConnection) await conn.beginTransaction();
    const lead = await findLeadById({ tenantId, leadId, db: conn, forUpdate: true });
    if (!lead) {
      const error = new Error('Lead not found');
      error.statusCode = 404;
      throw error;
    }
    const [[staff]] = await conn.query(
      "SELECT id,name FROM staff WHERE id=? AND tenant_id=? AND UPPER(role)='SALES' AND is_active=1 AND deleted_at IS NULL LIMIT 1",
      [salesId, tenantId]
    );
    if (!staff) {
      const error = new Error('Active sales staff not found');
      error.statusCode = 409;
      throw error;
    }
    if (String(lead.assigned_sales_id || '') === String(staff.id)) {
      if (ownsConnection) await conn.commit();
      return { changed: false, leadId, salesId: staff.id, salesName: staff.name };
    }
    await conn.query(
      'UPDATE leads SET assigned_sales_id=?,assigned_sales_name=?,updated_at=NOW() WHERE id=? AND tenant_id=?',
      [staff.id, staff.name, leadId, tenantId]
    );
    await logLeadEventStrict(leadId, 'assigned', reason, {
      fromSalesId: lead.assigned_sales_id || null,
      fromSalesName: lead.assigned_sales_name || null,
      salesId: staff.id,
      salesName: staff.name,
      actor,
      ...metadata,
    }, tenantId, conn);
    if (ownsConnection) await conn.commit();
    return { changed: true, leadId, salesId: staff.id, salesName: staff.name };
  } catch (error) {
    if (ownsConnection) await conn.rollback().catch(() => {});
    throw error;
  } finally {
    if (ownsConnection) conn.release();
  }
}

module.exports = { assignLead, createRepRotation, getNextSalesRep, listDistributableReps };
