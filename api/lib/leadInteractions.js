'use strict';

const crypto = require('crypto');
const { pool } = require('./db');
const { logLeadEventStrict } = require('./crm');
const { findLeadById } = require('./leadRepository');
const outbox = require('./outbox');

const TYPES = new Set([
  'CALL', 'WHATSAPP', 'EMAIL', 'MEETING', 'NOTE',
  'PAYMENT_FOLLOWUP', 'NEW_COURSE_SALE', 'CERTIFICATE',
]);

function interactionType(value) {
  const type = String(value || 'NOTE').trim().toUpperCase();
  if (!TYPES.has(type)) {
    const error = new Error('Invalid interaction type');
    error.statusCode = 400;
    throw error;
  }
  return type;
}

async function appendLeadInteraction({
  tenantId, leadId, interaction, actor = {}, staffId = null, db = null,
}) {
  if (!tenantId || !leadId) {
    const error = new Error('tenantId and leadId are required');
    error.statusCode = 400;
    throw error;
  }
  const notes = String(interaction?.notes || interaction?.description || '').trim().slice(0, 2000);
  if (!notes) {
    const error = new Error('Interaction notes are required');
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
    const type = interactionType(interaction?.type);
    const fallbackId = `li-${crypto.createHash('sha256').update(
      `${tenantId}|${leadId}|${interaction?.date || ''}|${type}|${notes}`
    ).digest('hex').slice(0, 33)}`;
    const id = String(interaction?.id || fallbackId).slice(0, 36);
    const at = interaction?.date && !Number.isNaN(Date.parse(interaction.date))
      ? new Date(interaction.date) : new Date();
    const outcome = String(interaction?.outcome || '').trim().slice(0, 500) || null;
    const nextFollowUp = interaction?.nextFollowUp && !Number.isNaN(Date.parse(interaction.nextFollowUp))
      ? new Date(interaction.nextFollowUp) : null;
    const [inserted] = await conn.query(
      `INSERT IGNORE INTO communications
       (id,tenant_id,lead_id,type,date,notes,outcome,next_follow_up,staff_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, tenantId, leadId, type, at, notes, outcome, nextFollowUp, staffId]
    );
    if (inserted.affectedRows) {
      await conn.query(
        `UPDATE leads SET last_follow_up=?,last_contact_note=?,
         next_follow_up_date=COALESCE(?,next_follow_up_date),updated_at=NOW()
         WHERE id=? AND tenant_id=?`,
        [at, notes, nextFollowUp, leadId, tenantId]
      );
      await logLeadEventStrict(
        leadId, 'interaction', notes,
        { type: type.toLowerCase(), outcome, actor }, tenantId, conn
      );
    }
    if (ownsConnection) await conn.commit();
    return { id, changed: Boolean(inserted.affectedRows), type: type.toLowerCase(), at };
  } catch (error) {
    if (ownsConnection) await conn.rollback().catch(() => {});
    throw error;
  } finally {
    if (ownsConnection) conn.release();
  }
}

async function deleteLeadInteraction({
  tenantId, leadId, interactionId, actor = {}, db = null,
}) {
  const ownsConnection = !db;
  const conn = db || await pool.getConnection();
  try {
    if (ownsConnection) await conn.beginTransaction();
    const [[interaction]] = await conn.query(
      `SELECT id,type,date FROM communications
        WHERE tenant_id=? AND lead_id=? AND id=?
        LIMIT 1 FOR UPDATE`,
      [tenantId, leadId, interactionId]
    );
    if (!interaction) {
      const error = new Error('Interaction not found');
      error.statusCode = 404;
      throw error;
    }
    await conn.query(
      'DELETE FROM communications WHERE tenant_id=? AND lead_id=? AND id=?',
      [tenantId, leadId, interactionId]
    );
    const [[latest]] = await conn.query(
      `SELECT date,notes FROM communications
        WHERE tenant_id=? AND lead_id=?
        ORDER BY date DESC,id DESC LIMIT 1`,
      [tenantId, leadId]
    );
    await conn.query(
      `UPDATE leads SET last_follow_up=?,last_contact_note=?,updated_at=NOW()
        WHERE tenant_id=? AND id=?`,
      [latest?.date || null, latest?.notes || null, tenantId, leadId]
    );
    await logLeadEventStrict(
      leadId,
      'interaction_deleted',
      'CRM interaction removed',
      {
        interactionId,
        type: String(interaction.type || '').toLowerCase(),
        date: interaction.date,
        actor,
      },
      tenantId,
      conn
    );
    if (ownsConnection) await conn.commit();
    return { id: interactionId, deleted: true };
  } catch (error) {
    if (ownsConnection) await conn.rollback().catch(() => {});
    throw error;
  } finally {
    if (ownsConnection) conn.release();
  }
}

async function queueLeadWhatsAppBatch({
  tenantId, leadIds, message, actor = {}, staffId = null, accessScope = null,
}) {
  const ids = [...new Set((leadIds || []).map(String).filter(Boolean))];
  if (!tenantId || !ids.length || !String(message || '').trim()) {
    const error = new Error('lead ids and message are required');
    error.statusCode = 400;
    throw error;
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const scope = accessScope || { sql: '', params: [] };
    const params = [tenantId, ...ids, ...(scope.params || [])];
    const [leads] = await conn.query(
      `SELECT l.id,l.name,l.phone FROM leads l
       WHERE l.tenant_id=? AND l.id IN (${ids.map(() => '?').join(',')})
         AND l.hidden=0 AND l.phone IS NOT NULL AND l.phone!=''${scope.sql || ''}
       FOR UPDATE`,
      params
    );
    const hash = crypto.createHash('sha256').update(String(message)).digest('hex').slice(0, 16);
    const results = [];
    for (const lead of leads) {
      const phone = String(lead.phone).replace(/\D/g, '');
      const personalized = String(message)
        .replace(/\{\{?name\}?\}/g, lead.name || '')
        .replace(/\{\{?phone\}?\}/g, lead.phone || '');
      await outbox.enqueue({
        channel: 'whatsapp',
        recipient: phone,
        payload: { message: personalized },
        tenantId,
        refType: 'lead',
        refId: lead.id,
        dedupeKey: `crm-wa:${tenantId}:${lead.id}:${hash}`,
      }, conn);
      await appendLeadInteraction({
        tenantId,
        leadId: lead.id,
        interaction: {
          id: `wa-${crypto.createHash('sha256').update(`${tenantId}:${lead.id}:${hash}`).digest('hex').slice(0, 33)}`,
          type: 'whatsapp',
          notes: `رسالة مجمعة: ${personalized.slice(0, 500)}`,
          outcome: 'queued',
        },
        actor,
        staffId,
        db: conn,
      });
      results.push({ id: lead.id, phone, ok: true });
    }
    await conn.commit();
    return results;
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally { conn.release(); }
}

module.exports = {
  appendLeadInteraction,
  deleteLeadInteraction,
  queueLeadWhatsAppBatch,
  interactionType,
  TYPES,
};
