'use strict';
/**
 * Transactional outbox for email/whatsapp (Top20 #7). Enqueue a message in the
 * same DB write path as the business change, then drain() it from a worker with
 * exponential backoff — durable, retryable delivery instead of fire-and-forget.
 */
const { pool } = require('./db');
const { uuidv4 } = require('./id');
const logger = require('./logger');

const MAX_ATTEMPTS = 6;

// Enqueue. Pass `conn` to enlist in an existing transaction. `sendAt` (Date or
// ms-from-epoch) schedules a delayed send (used by the lifecycle journey).
async function enqueue({ channel, recipient, subject, payload, tenantId = 'mahad', sendAt = null, dedupeKey = null }, conn = pool) {
  const when = sendAt ? new Date(sendAt) : null;
  // dedupeKey (unique) makes re-enqueues within the same period a no-op.
  await conn.query(
    `INSERT INTO message_outbox (id, tenant_id, channel, recipient, subject, payload_json, next_attempt_at, dedupe_key)
     VALUES (?,?,?,?,?,?, COALESCE(?, NOW()), ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [uuidv4(), tenantId, channel, recipient, subject || null, JSON.stringify(payload || {}),
     when && !isNaN(when.getTime()) ? when : null, dedupeKey]
  );
}

// Drain due pending rows. `senders` = { email: fn, whatsapp: fn }.
async function drain(senders, limit = 20) {
  const [rows] = await pool.query(
    "SELECT * FROM message_outbox WHERE status='pending' AND next_attempt_at<=NOW() ORDER BY next_attempt_at LIMIT ?",
    [limit]
  );
  let sent = 0;
  for (const m of rows) {
    try {
      const payload = typeof m.payload_json === 'string' ? JSON.parse(m.payload_json) : (m.payload_json || {});
      const send = senders[m.channel];
      if (typeof send !== 'function') throw new Error('no sender for channel ' + m.channel);
      await send({ recipient: m.recipient, subject: m.subject, ...payload });
      await pool.query("UPDATE message_outbox SET status='sent', sent_at=NOW() WHERE id=?", [m.id]);
      sent++;
    } catch (e) {
      const attempts = (m.attempts || 0) + 1;
      const dead = attempts >= MAX_ATTEMPTS;
      const backoff = Math.min(60, 2 ** attempts);
      await pool.query(
        `UPDATE message_outbox SET status=?, attempts=?, last_error=?,
           next_attempt_at=DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id=?`,
        [dead ? 'dead' : 'pending', attempts, e.message, backoff, m.id]
      );
      logger.warn('[outbox] delivery failed', { id: m.id, channel: m.channel, attempts, err: e.message });
    }
  }
  return sent;
}

module.exports = { enqueue, drain, MAX_ATTEMPTS };
