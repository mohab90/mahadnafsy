'use strict';

const { pool } = require('./db');
const { uuidv4 } = require('./id');
const { findLeadById } = require('./leadRepository');
const { LEAD_STATUSES, normalizeLeadStatus } = require('./leadStatuses');
const { validateTransition } = require('./leadPipeline');

async function transitionLead({
  tenantId,
  leadId,
  toStatus,
  actor = null,
  reason = null,
  metadata = {},
  db = null,
}) {
  if (!tenantId || !leadId) {
    const error = new Error('tenantId and leadId are required');
    error.statusCode = 400;
    throw error;
  }
  const status = normalizeLeadStatus(toStatus);
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
    const fromStatus = String(lead.status || '').toLowerCase();
    if (fromStatus === status) {
      if (ownsConnection) await conn.commit();
      return { changed: false, fromStatus, toStatus: status };
    }
    await validateTransition(tenantId, fromStatus, status, conn);
    await conn.query(
      'UPDATE leads SET status=?, updated_at=NOW() WHERE id=? AND tenant_id=?',
      [status, leadId, tenantId]
    );
    await conn.query(
      `INSERT INTO lead_timeline (id,tenant_id,lead_id,event_type,description,meta_json,at)
       VALUES (?,?,?,'status_changed',?,?,NOW())`,
      [uuidv4(), tenantId, leadId, reason || `Status changed: ${fromStatus || 'unknown'} -> ${status}`,
        JSON.stringify({ from: fromStatus || null, to: status, actor, ...metadata })]
    );
    if (ownsConnection) await conn.commit();
    return { changed: true, fromStatus, toStatus: status };
  } catch (error) {
    if (ownsConnection) await conn.rollback().catch(() => {});
    throw error;
  } finally {
    if (ownsConnection) conn.release();
  }
}

module.exports = { LEAD_STATUSES, normalizeLeadStatus, transitionLead };
