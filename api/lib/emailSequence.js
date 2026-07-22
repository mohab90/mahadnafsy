'use strict';

const { pool } = require('./db');
const outbox = require('./outbox');

const ALLOWED_TRIGGERS = new Set(['registration', 'enrollment', 'payment', 'lead_created']);

async function enqueueEmailSequence({ tenantId, triggerEvent, recipientEmail, recipientName = '', triggerTime = Date.now() }, db = pool) {
  const email = String(recipientEmail || '').trim().toLowerCase();
  if (!tenantId || !ALLOWED_TRIGGERS.has(triggerEvent) || !email.includes('@')) {
    const error = new Error('Valid tenant, trigger and recipient are required');
    error.statusCode = 400;
    throw error;
  }
  const [steps] = await db.query(
    `SELECT st.id,st.delay_hours,st.subject,st.body_html
       FROM email_sequences seq
       JOIN email_sequence_steps st ON st.sequence_id=seq.id AND st.tenant_id=seq.tenant_id
      WHERE seq.tenant_id=? AND seq.trigger_event=? AND seq.is_active=1
      ORDER BY seq.id,st.step_order`,
    [tenantId, triggerEvent]
  );
  const startedAt = Number(new Date(triggerTime));
  for (const step of steps) {
    const sendAt = new Date((Number.isFinite(startedAt) ? startedAt : Date.now()) + Number(step.delay_hours || 0) * 3600000);
    await outbox.enqueue({
      channel: 'email', recipient: email, subject: step.subject,
      payload: { html: String(step.body_html || '').replace(/{{name}}/gi, recipientName || '') },
      tenantId, sendAt, dedupeKey: `email-sequence:${tenantId}:${step.id}:${email}`,
      refType: 'email_sequence_step', refId: step.id,
    }, db);
  }
  return steps.length;
}

async function promoteLegacyEmailSequenceQueue(limit = 50) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT q.id,q.tenant_id,q.recipient_email,q.recipient_name,q.scheduled_at,
              st.id AS step_id,st.subject,st.body_html
         FROM email_sequence_queue q
         JOIN email_sequence_steps st ON st.id=q.step_id AND st.tenant_id=q.tenant_id
        WHERE q.sent_at IS NULL AND q.failed_at IS NULL
        ORDER BY q.scheduled_at LIMIT ? FOR UPDATE`,
      [Math.min(Math.max(Number(limit) || 50, 1), 200)]
    );
    for (const row of rows) {
      await outbox.enqueue({
        channel: 'email', recipient: row.recipient_email, subject: row.subject,
        payload: { html: String(row.body_html || '').replace(/{{name}}/gi, row.recipient_name || '') },
        tenantId: row.tenant_id, sendAt: row.scheduled_at,
        dedupeKey: `legacy-email-sequence:${row.tenant_id}:${row.id}`,
        refType: 'email_sequence_step', refId: row.step_id,
      }, conn);
      await conn.query('UPDATE email_sequence_queue SET sent_at=NOW() WHERE id=? AND tenant_id=?', [row.id, row.tenant_id]);
    }
    await conn.commit();
    return rows.length;
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally { conn.release(); }
}

module.exports = { enqueueEmailSequence, promoteLegacyEmailSequenceQueue, ALLOWED_TRIGGERS };
