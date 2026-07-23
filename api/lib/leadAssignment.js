'use strict';

const { pool } = require('./db');
const { logLeadEventStrict } = require('./crm');

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
async function getNextSalesRep(tenantId, db = pool) {
  const [reps] = await db.query(
    `SELECT s.id, s.name FROM staff s
     LEFT JOIN leads l
       ON l.assigned_sales_id = s.id AND l.tenant_id = s.tenant_id AND l.hidden = 0
      AND l.status NOT IN ('converted','lost','archived','disqualified')
     WHERE s.tenant_id=? AND s.is_active=1 AND s.deleted_at IS NULL AND UPPER(s.role) IN ('SALES','MANAGER')
     GROUP BY s.id, s.name
     ORDER BY COUNT(l.id) ASC, s.name ASC
     LIMIT 1`,
    [tenantId]
  );
  return reps[0] || null;
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
    const [[lead]] = await conn.query(
      'SELECT id,assigned_sales_id,assigned_sales_name FROM leads WHERE id=? AND tenant_id=? AND hidden=0 LIMIT 1 FOR UPDATE',
      [leadId, tenantId]
    );
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

module.exports = { assignLead, getNextSalesRep };
