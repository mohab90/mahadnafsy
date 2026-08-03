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
/**
 * @returns {Promise<string|null>} the queued message id — the existing one when
 *   dedupeKey matched an earlier enqueue, so a caller that tracks per-recipient
 *   state (campaigns) can record the row that will actually be delivered rather
 *   than a id that was never inserted. Callers that ignore it are unaffected.
 */
async function enqueue({ channel, recipient, subject, payload, tenantId = DEFAULT_TENANT, sendAt = null, dedupeKey = null, refType = null, refId = null, channelId = null }, conn = pool) {
  const when = sendAt ? new Date(sendAt) : null;
  const id = uuidv4();
  // dedupeKey (unique) makes re-enqueues within the same period a no-op.
  const [result] = await conn.query(
    `INSERT INTO message_outbox (id, tenant_id, channel, channel_id, recipient, subject, payload_json, next_attempt_at, dedupe_key, ref_type, ref_id)
     VALUES (?,?,?,?,?,?,?, COALESCE(?, NOW()), ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [id, tenantId, channel, channelId, recipient, subject || null, JSON.stringify(payload || {}),
     when && !isNaN(when.getTime()) ? when : null, dedupeKey, refType, refId]
  );
  // affectedRows is 0 only when ON DUPLICATE KEY matched an existing row and
  // changed nothing. Anything else — including a driver or a test double that
  // does not report it — means the insert happened and `id` is the row.
  if (!dedupeKey || result?.affectedRows !== 0) return id;
  const [[existing]] = await conn.query(
    'SELECT id FROM message_outbox WHERE dedupe_key=? LIMIT 1', [dedupeKey]
  );
  return existing?.id || null;
}

/**
 * A message has given up. Tell a human.
 *
 * Everything else about a failed send is already visible — the row keeps its
 * last_error, the campaign counters move — but none of that is looked at unless
 * someone already suspects a problem. So a customer waiting on a reply that died
 * in the queue produced silence: the rep believes it was sent, the customer
 * believes they were ignored.
 *
 * The notice goes to whoever owns that customer when the message is addressed to
 * one, and to everyone otherwise. Campaign messages are deliberately excluded:
 * a blast to 5,000 people with a 2% failure rate would bury the inbox in 100
 * notifications that say nothing the campaign report does not already say
 * better.
 */
async function announceDeadLetter(row, error) {
  if (row.ref_type === 'whatsapp_campaign' || row.ref_type === 'email_campaign' || row.ref_type === 'sms_campaign') {
    return;
  }
  const { createNotification } = require('./notification');
  const recipient = String(row.recipient || '').slice(0, 40);

  // Find who owns this customer, so the person who will actually chase it is
  // the one who hears about it. Matched on the address the message went to.
  let staffId = null;
  let name = null;
  try {
    const [[owner]] = await pool.query(
      `SELECT s.assigned_cs_id AS staff_id, s.name
         FROM subscribers s
        WHERE s.tenant_id=? AND s.phone IN (?, ?) AND s.deleted_at IS NULL
        LIMIT 1`,
      [row.tenant_id, recipient, `0${String(recipient).replace(/^20/, '')}`]
    );
    if (owner) { staffId = owner.staff_id; name = owner.name; }
    else {
      const [[lead]] = await pool.query(
        `SELECT l.assigned_sales_id AS staff_id, l.name
           FROM leads l
          WHERE l.tenant_id=? AND l.phone IN (?, ?) AND l.hidden=0
          LIMIT 1`,
        [row.tenant_id, recipient, `0${String(recipient).replace(/^20/, '')}`]
      );
      if (lead) { staffId = lead.staff_id; name = lead.name; }
    }
  } catch (lookupError) {
    // Identifying the owner is a nicety; the notification itself is the point.
    logger.warn('[outbox] dead-letter owner lookup failed', lookupError.message);
  }

  const channelLabel = row.channel === 'email' ? 'إيميل'
    : row.channel === 'messenger' ? 'ماسنجر' : 'واتساب';
  await createNotification(
    'delivery_failed',
    `⚠️ رسالة ${channelLabel} لم تصل`,
    `${name ? `${name} — ` : ''}${recipient}: ${String(error?.message || error || '').slice(0, 140)}`,
    { outboxId: row.id, channel: row.channel, recipient, refType: row.ref_type || null },
    row.tenant_id,
    staffId
  );
}

async function finalizeCampaign(row, sent, dead) {
  if (row.ref_type === 'crm_sequence_step' && row.ref_id) {
    await pool.query(
      `UPDATE crm_sequence_step_executions
          SET status=?,sent_at=IF(?,NOW(),sent_at)
        WHERE id=? AND tenant_id=?`,
      [dead ? 'failed' : 'sent', sent ? 1 : 0, row.ref_id, row.tenant_id]
    );
    return;
  }
  const table = row.ref_type === 'email_campaign' ? 'email_campaigns'
    : row.ref_type === 'sms_campaign' ? 'sms_campaigns'
      : row.ref_type === 'whatsapp_campaign' ? 'whatsapp_campaigns'
        : null;
  if (!table || !row.ref_id) return;

  // WhatsApp campaigns keep a per-recipient row so "why didn't Ahmed get it?"
  // has an answer. Without this it would sit at 'queued' forever, even after
  // the message was delivered or gave up.
  if (row.ref_type === 'whatsapp_campaign') {
    await pool.query(
      `UPDATE whatsapp_campaign_recipients SET status=?
        WHERE tenant_id=? AND campaign_id=? AND outbox_id=?`,
      [sent ? 'sent' : dead ? 'failed' : 'queued', row.tenant_id, row.ref_id, row.id]
    ).catch(() => {});
  }
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
      // channel_id travels with the row so a queued message is delivered from
      // the identity it was composed for, even if the tenant default changed
      // between queueing and sending. The payload may still override it.
      const delivery = await send({
        recipient: m.recipient, subject: m.subject, tenantId: m.tenant_id,
        channelId: m.channel_id || null, ...payload,
      });
      if (delivery?.ok === false) {
        const reason = typeof delivery.reason === 'string' ? delivery.reason : JSON.stringify(delivery.reason);
        throw new Error(reason || `${m.channel} provider rejected the message`);
      }
      await pool.query(
        `UPDATE message_outbox
            SET status='sent',sent_at=NOW(),locked_at=NULL,locked_by=NULL,last_error=NULL,
                provider=?,provider_message_id=?,delivery_status=?,
                provider_status_at=IF(? IS NULL,provider_status_at,NOW()),provider_error=NULL
          WHERE id=? AND tenant_id=? AND locked_by=?`,
        [
          delivery?.provider || null,
          delivery?.idMessage || null,
          delivery?.idMessage ? 'accepted' : null,
          delivery?.idMessage || null,
          m.id,
          m.tenant_id,
          workerId,
        ]
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
      if (dead) {
        await finalizeCampaign(m, false, true);
        await announceDeadLetter(m, e).catch(error =>
          logger.warn('[outbox] dead-letter notice failed', error.message));
      }
      logger.warn('[outbox] delivery failed', { id: m.id, channel: m.channel, attempts, err: e.message });
    }
  }
  return sent;
}

module.exports = { enqueue, drain, MAX_ATTEMPTS, finalizeCampaign, announceDeadLetter };
