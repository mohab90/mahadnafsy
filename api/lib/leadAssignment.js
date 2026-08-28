'use strict';

const { pool } = require('./db');
const { logLeadEventStrict } = require('./crm');
const { findLeadById } = require('./leadRepository');
const { normalizeBranch } = require('./leadAssignmentPolicy');
const { intakeByStaff, hasRoom } = require('./assignmentQuota');

// Canonical "least-loaded" sales-rep picker for single-lead auto-assignment
// at capture time (public registration, chatbot capture, self-registration,
// Facebook Lead Ads webhook). Previously reimplemented 4 separate times with
// diverging fairness rules — the two most impactful bugs this closes:
//   - Some copies counted EVERY non-hidden lead ever assigned to a rep,
//     including years-old converted/lost ones, toward their "load". A
//     veteran rep who has converted hundreds of leads over time looks
//     permanently "overloaded" and stops receiving new auto-assigned leads,
//     while a brand-new hire with zero history gets everything. This version
//     only counts leads still in a non-terminal status (matching the one
//     implementation — crm-advanced.js's smart-route — that already had this
//     right).
//   - api/lib/facebookLeadAds.js's copy queried staff/leads outside any
//     transaction with no is_active/deleted_at guard consistency with the
//     others; folded in here.
// Bulk operations (admin/leads.js's cyclic bulk-assign, crm-advanced.js's
// smart-route re-sorting batch distributor) are intentionally NOT routed
// through this — they distribute a whole batch in one pass with their own
// rebalancing strategy, which this single-pick helper isn't shaped for.
async function getNextSalesRep(tenantId, db = pool, options = {}) {
  const branch = normalizeBranch(options.branch);
  const teamKey = String(options.teamKey || 'sales').trim().toLowerCase();
  const [rows] = await db.query(
    `SELECT s.id,s.name,p.id AS policy_id,p.branch_key,p.weight,p.max_open_leads,
            p.is_available,p.last_assigned_at,p.intake_limit,p.intake_period
       FROM staff s
       LEFT JOIN crm_assignment_members p
         ON p.tenant_id=s.tenant_id AND p.staff_id=s.id AND p.team_key=?
        AND p.branch_key IN (?, '*')
      WHERE s.tenant_id=? AND s.is_active=1 AND s.deleted_at IS NULL AND UPPER(s.role)='SALES'`,
    [teamKey, branch, tenantId]
  );
  const [loads] = await db.query(
    `SELECT assigned_sales_id,COUNT(*) active_leads FROM leads
      WHERE tenant_id=? AND hidden=0
        AND status NOT IN ('converted','lost','archived','disqualified')
        AND assigned_sales_id IS NOT NULL GROUP BY assigned_sales_id`,
    [tenantId]
  );
  const loadByStaff = new Map(loads.map(row => [String(row.assigned_sales_id), Number(row.active_leads)]));
  const selectedPolicy = new Map();
  for (const row of rows) {
    const current = selectedPolicy.get(row.id);
    if (!current || (row.branch_key === branch && current.branch_key !== branch)) selectedPolicy.set(row.id, row);
  }
  // How many each rep has already been handed inside their own window. A rep
  // with no intake_limit is unaffected; the count is still cheap to take.
  const candidates = [...selectedPolicy.values()];
  const intake = await intakeByStaff(
    tenantId,
    candidates.filter(row => row.intake_limit != null).map(row => ({
      staff_id: row.id, intake_period: row.intake_period,
    })),
    db
  );

  const reps = candidates
    .map(row => ({ ...row, activeLeads: loadByStaff.get(String(row.id)) || 0 }))
    // Either cap stops a rep receiving: the number they hold open, and the
    // number they have taken in this period.
    .filter(row => row.policy_id == null || (
      Boolean(row.is_available)
      && (row.max_open_leads == null || row.activeLeads < Number(row.max_open_leads))
      && hasRoom(row, intake.get(String(row.id)) || 0)
    ))
    .sort((a, b) =>
      (a.activeLeads / Math.max(Number(a.weight) || 1, 0.1)) - (b.activeLeads / Math.max(Number(b.weight) || 1, 0.1)) ||
      new Date(a.last_assigned_at || 0) - new Date(b.last_assigned_at || 0) ||
      String(a.name).localeCompare(String(b.name))
    );
  const rep = reps[0] || null;
  if (rep?.policy_id) {
    await db.query(
      'UPDATE crm_assignment_members SET last_assigned_at=NOW() WHERE id=? AND tenant_id=?',
      [rep.policy_id, tenantId]
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
      // assigned_at is what the intake cap counts over. The column has existed
      // for a while and nothing wrote to it — all 2,380 assigned leads had it
      // NULL — so no cap could have worked before this.
      'UPDATE leads SET assigned_sales_id=?,assigned_sales_name=?,assigned_at=NOW(),updated_at=NOW() WHERE id=? AND tenant_id=?',
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


/**
 * A picker for a whole import run.
 *
 * getNextSalesRep answers one lead at a time and takes two queries plus a write
 * to do it. The sheet sync assigns inside a loop that has run 2,078 leads in a
 * single pass, and its own copy of the fairness rules did a GROUP BY per lead
 * for the "least loaded" mode — an N+1 the size of the import.
 *
 * This loads the roster, the open-lead counts and the period intake once, then
 * picks in memory and keeps its own running totals, so a batch costs one read
 * rather than one per row. The rules are the same ones getNextSalesRep applies:
 * unavailable reps are skipped, the open cap and the intake cap both stop a rep
 * receiving, and among those left the least loaded goes first with the longest
 * wait breaking ties.
 *
 * Returns null once every rep is capped, and the caller leaves the lead
 * unassigned rather than pushing someone past a limit the owner set.
 */
async function createBatchAssigner(tenantId, db = pool, options = {}) {
  const branch = normalizeBranch(options.branch);
  const teamKey = String(options.teamKey || 'sales').trim().toLowerCase();

  const [rows] = await db.query(
    `SELECT s.id,s.name,p.id AS policy_id,p.branch_key,p.weight,p.max_open_leads,
            p.is_available,p.last_assigned_at,p.intake_limit,p.intake_period
       FROM staff s
       LEFT JOIN crm_assignment_members p
         ON p.tenant_id=s.tenant_id AND p.staff_id=s.id AND p.team_key=?
        AND p.branch_key IN (?, '*')
      WHERE s.tenant_id=? AND s.is_active=1 AND s.deleted_at IS NULL AND UPPER(s.role)='SALES'`,
    [teamKey, branch, tenantId]
  );

  const [loads] = await db.query(
    `SELECT assigned_sales_id,COUNT(*) active_leads FROM leads
      WHERE tenant_id=? AND hidden=0
        AND status NOT IN ('converted','lost','archived','disqualified')
        AND assigned_sales_id IS NOT NULL GROUP BY assigned_sales_id`,
    [tenantId]
  );
  const loadByStaff = new Map(loads.map(row => [String(row.assigned_sales_id), Number(row.active_leads)]));

  // one policy row per rep, preferring the branch-specific one over the wildcard
  const selected = new Map();
  for (const row of rows) {
    const current = selected.get(row.id);
    if (!current || (row.branch_key === branch && current.branch_key !== branch)) selected.set(row.id, row);
  }

  const candidates = [...selected.values()];
  const intake = await intakeByStaff(
    tenantId,
    candidates.filter(row => row.intake_limit != null).map(row => ({
      staff_id: row.id, intake_period: row.intake_period,
    })),
    db
  );

  const state = candidates.map(row => ({
    id: row.id,
    name: row.name,
    policyId: row.policy_id,
    available: row.policy_id == null ? true : Boolean(row.is_available),
    weight: Math.max(Number(row.weight) || 1, 0.1),
    maxOpen: row.policy_id == null ? null : row.max_open_leads,
    intakeLimit: row.policy_id == null ? null : row.intake_limit,
    intakePeriod: row.intake_period,
    open: loadByStaff.get(String(row.id)) || 0,
    taken: intake.get(String(row.id)) || 0,
    lastAt: row.last_assigned_at ? new Date(row.last_assigned_at).getTime() : 0,
    given: 0,
  }));

  let clock = Date.now();

  return {
    /** The rep who should take the next lead, or null when everyone is capped. */
    next() {
      const open = state
        .filter(rep => rep.available)
        .filter(rep => rep.maxOpen == null || rep.open < Number(rep.maxOpen))
        .filter(rep => hasRoom({ intake_limit: rep.intakeLimit }, rep.taken))
        .sort((a, b) =>
          (a.open / a.weight) - (b.open / b.weight) ||
          a.lastAt - b.lastAt ||
          String(a.name).localeCompare(String(b.name))
        );
      const rep = open[0];
      if (!rep) return null;
      rep.open += 1;
      rep.taken += 1;
      rep.given += 1;
      rep.lastAt = ++clock;
      return { id: rep.id, name: rep.name };
    },

    /** Everyone who took at least one, for the run's log line. */
    summary() {
      return state.filter(rep => rep.given > 0).map(rep => ({ name: rep.name, given: rep.given }));
    },

    /** True when nobody can take another — the caller can stop trying. */
    exhausted() {
      return !state.some(rep =>
        rep.available
        && (rep.maxOpen == null || rep.open < Number(rep.maxOpen))
        && hasRoom({ intake_limit: rep.intakeLimit }, rep.taken));
    },

    /** Persist the rotation so the next run does not restart from the same rep. */
    async flush() {
      for (const rep of state) {
        if (!rep.given || !rep.policyId) continue;
        await db.query(
          'UPDATE crm_assignment_members SET last_assigned_at=NOW() WHERE id=? AND tenant_id=?',
          [rep.policyId, tenantId]
        );
      }
    },
  };
}

module.exports = { assignLead, getNextSalesRep, createBatchAssigner };
