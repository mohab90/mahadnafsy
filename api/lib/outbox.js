'use strict';
/**
 * Transactional outbox for email/whatsapp (Top20 #7). Enqueue a message in the
 * same DB write path as the business change, then drain() it from a worker with
 * exponential backoff — durable, retryable delivery instead of fire-and-forget.
 */
const { pool } = require('./db');
const { uuidv4 } = require('./id');
const logger = require('./logger');
const { DEFAULT_TENANT } = require('../middleware/tenantContext');

const MAX_ATTEMPTS = 6;

// Enqueue. Pass `conn` to enlist in an existing transaction. `sendAt` (Date or
// ms-from-epoch) schedules a delayed send (used by the lifecycle journey).
async function enqueue({ channel, recipient, subject, payload, tenantId = DEFAULT_TENANT, sendAt = null, dedupeKey = null, refType = null, refId = null }, conn = pool) {
  const when = sendAt ? new Date(sendAt) : null;
  // dedupeKey (unique) makes re-enqueues within the same period a no-op.
  await conn.query(
    `INSERT INTO message_outbox (id, tenant_id, channel, recipient, subject, payload_json, next_attempt_at, dedupe_key, ref_type, ref_id)
     VALUES (?,?,?,?,?,?, COALESCE(?, NOW()), ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [uuidv4(), tenantId, channel, recipient, subject || null, JSON.stringify(payload || {}),
     when && !isNaN(when.getTime()) ? when : null, dedupeKey, refType, refId]
  );
}

async function finalizeCampaign(row, sent, dead) {
  const table = row.ref_type === 'email_campaign' ? 'email_campaigns' : row.ref_type === 'sms_campaign' ? 'sms_campaigns' : null;
  if (!table || !row.ref_id) return;
  if (sent) await pool.query(`UPDATE ${table} SET sent_count=sent_count+1 WHERE id=? AND tenant_id=?`, [row.ref_id, row.tenant_id]);
  if (dead) await pool.query(`UPDATE ${table} SET fail_count=fail_count+1 WHERE id=? AND tenant_id=?`, [row.ref_id, row.tenant_id]);
  const [[remaining]] = await pool.query(
    `SELECT SUM(status IN ('pending','processing','failed')) AS remaining,SUM(status='dead') AS dead_count
       FROM message_outbox WHERE tenant_id=? AND ref_type=? AND ref_id=?`,
    [row.tenant_id, row.ref_type, row.ref_id]
  );
  if (Number(remaining?.remaining || 0) === 0) {
    await pool.query(
      `UPDATE ${table} SET status=?,sent_at=NOW() WHERE id=? AND tenant_id=?`,
      [Number(remaining?.dead_count || 0) ? 'failed' : 'sent', row.ref_id, row.tenant_id]
    );
  }
}

// Drain due pending rows. `senders` = { email: fn, whatsapp: fn }.
async function drain(senders, limit = 20) {
  const workerId = `message-${process.pid}-${uuidv4()}`;
  const batchSize = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const conn = await pool.getConnection();
  let rows = [];
  try {
    await conn.beginTransaction();
    [rows] = await conn.query(
      `SELECT * FROM message_outbox
        WHERE ((status IN ('pending','failed') AND next_attempt_at<=NOW())
           OR (status='processing' AND locked_at<DATE_SUB(NOW(),INTERVAL 15 MINUTE)))
        ORDER BY next_attempt_at LIMIT ? FOR UPDATE`,
      [batchSize]
    );
    if (rows.length) {
      await conn.query(
        `UPDATE message_outbox SET status='processing',locked_at=NOW(),locked_by=?
          WHERE id IN (${rows.map(() => '?').join(',')})`,
        [workerId, ...rows.map(row => row.id)]
      );
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally { conn.release(); }
  let sent = 0;
  for (const m of rows) {
    try {
      const payload = typeof m.payload_json === 'string' ? JSON.parse(m.payload_json) : (m.payload_json || {});
      const send = senders[m.channel];
      if (typeof send !== 'function') throw new Error('no sender for channel ' + m.channel);
      await send({ recipient: m.recipient, subject: m.subject, tenantId: m.tenant_id, ...payload });
      await pool.query(
        "UPDATE message_outbox SET status='sent',sent_at=NOW(),locked_at=NULL,locked_by=NULL,last_error=NULL WHERE id=? AND tenant_id=? AND locked_by=?",
        [m.id, m.tenant_id, workerId]
      );
      await finalizeCampaign(m, true, false);
      sent++;
    } catch (e) {
      const attempts = (m.attempts || 0) + 1;
      const dead = attempts >= MAX_ATTEMPTS;
      const backoff = Math.min(60, 2 ** attempts);
      await pool.query(
        `UPDATE message_outbox SET status=?,attempts=?,last_error=?,locked_at=NULL,locked_by=NULL,
           next_attempt_at=DATE_ADD(NOW(),INTERVAL ? MINUTE) WHERE id=? AND tenant_id=? AND locked_by=?`,
        [dead ? 'dead' : 'failed', attempts, String(e.message || e).slice(0, 2000), backoff, m.id, m.tenant_id, workerId]
      );
      if (dead) await finalizeCampaign(m, false, true);
      logger.warn('[outbox] delivery failed', { id: m.id, channel: m.channel, attempts, err: e.message });
    }
  }
  return sent;
}

module.exports = { enqueue, drain, MAX_ATTEMPTS, finalizeCampaign };
