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
  // Skip the configurable-pipeline check. Reserved for transitions driven by a
  // fact that already happened and cannot be undone by a workflow rule — a
  // confirmed provider payment being the case this exists for. Without it, a
  // tenant whose custom pipeline omits the lead's current status would get a 409
  // from validateTransition and the paying customer would stay an open lead.
  // Everything else (locking, the UPDATE, the timeline row) still goes through
  // this one service, so history stays consistent.
  force = false,
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
    if (!force) await validateTransition(tenantId, fromStatus, status, conn);

    // 'converted' has to mean a customer exists.
    //
    // Production carries 34 real leads sitting at converted with no subscriber
    // behind them — Google Sheet imports with no email, mostly, all stamped
    // within a second of each other on 2026-08-06. Converted leads are excluded
    // from the pipeline, so each of those people left the sales list without
    // arriving anywhere: nobody is chasing them and no customer record answers
    // for them. They are invisible in exactly the way that stops anyone
    // noticing.
    //
    // The routes cannot write leads.status directly — crmLeadIntegrity pins
    // that — so this service is the one door, and it was not checking. Every one
    // of the nine callers that converts a lead already has a subscriber and
    // already names it in metadata.subscriberId, so the check costs them
    // nothing; what it stops is the tenth caller, and the bulk status edit,
    // from reopening the same hole.
    //
    // Accepts either the link (subscribers.lead_id) or the caller's own claim,
    // because they are not always the same: the payment-proof path converts on
    // proof.lead_id while the subscriber it activates may have been linked by
    // identity rather than by that column.
    if (status === 'converted') {
      const claimed = metadata?.subscriberId ? String(metadata.subscriberId) : null;
      const [[customer]] = await conn.query(
        `SELECT id FROM subscribers
          WHERE tenant_id=? AND (lead_id=?${claimed ? ' OR id=?' : ''}) LIMIT 1`,
        claimed ? [tenantId, leadId, claimed] : [tenantId, leadId]
      );
      if (!customer) {
        const error = new Error('لا يمكن تعليم الليد كمحوَّل قبل إنشاء العميل — استخدم مسار التحويل');
        error.statusCode = 409;
        throw error;
      }
    }

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
