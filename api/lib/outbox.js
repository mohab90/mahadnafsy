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
  // Scoped to the tenant, because the key is. The unique index is on
  // (tenant_id, dedupe_key), so the row this insert collided with is this
  // tenant's — but the lookup searched the key alone, and two tenants
  // generating the same key (a date, a lead id, a template name) would hand
  // this caller the other one's message id to hold on to.
  const [[existing]] = await conn.query(
    'SELECT id FROM message_outbox WHERE tenant_id=? AND dedupe_key=? LIMIT 1',
    [tenantId, dedupeKey]
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
// Faults that belong to the channel, not to the person being written to.
//
// The campaign exclusion below was meant to stop one bad run from burying the
// inbox, but a channel outage does the same thing by a different route: every
// message fails, every failure is its own notification. It happened — bad SMTP
// credentials and a WhatsApp daily cap produced 4,610 delivery_failed notices,
// 4,267 of them unread and 55% of every notification in the system, which
// buried the lead and payment notices they sit next to.
//
// One notice per channel per hour says the same thing and leaves the inbox
// usable. Per-recipient faults are excluded on purpose: an invalid number is
// one customer to fix, and the rep who owns them should still hear about it.
const SYSTEMIC_FAILURE = [
  /authentication failed|Invalid login|535/i,
  /daily_limit_reached/i,
  /category_disabled/i,
  /ETIMEDOUT|ENETUNREACH|ECONNREFUSED|Connection timeout/i,
];

function isSystemicFailure(message) {
  const text = String(message || '');
  return SYSTEMIC_FAILURE.some(pattern => pattern.test(text));
}

async function channelAlreadyAnnounced(tenantId, channel) {
  try {
    // tenantId was taken as an argument and never used, so one tenant's outage
    // notice silenced every other tenant's for the hour.
    const [[recent]] = await pool.query(
      `SELECT id FROM notifications
        WHERE tenant_id=? AND type=? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)
          AND data_json LIKE ? LIMIT 1`,
      [tenantId, 'delivery_failed', `%"channelOutage":"${channel}"%`]
    );
    return !!recent;
  } catch (lookupError) {
    // If the check itself fails, announce. A duplicate notice beats silence.
    logger.warn('[outbox] outage-notice lookup failed', lookupError.message);
    return false;
  }
}
async function announceDeadLetter(row, error) {
  if (row.ref_type === 'whatsapp_campaign' || row.ref_type === 'email_campaign' || row.ref_type === 'sms_campaign') {
    return;
  }
  // A channel-level fault is announced once an hour, not once per message.
  const systemic = isSystemicFailure(error?.message || error);
  if (systemic && await channelAlreadyAnnounced(row.tenant_id, row.channel)) return;
  const { createNotification } = require('./notification');
  const recipient = String(row.recipient || '').slice(0, 40);

  // Find who owns this customer, so the person who will actually chase it is
  // the one who hears about it. Matched on the address the message went to.
  // Skipped on an outage: the notice goes to everyone and names no customer,
  // so neither lookup would be read.
  let staffId = null;
  let name = null;
  if (!systemic) try {
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
  // On an outage the recipient is incidental — naming one customer reads as one
  // customer's problem when every message is failing. Say what is actually wrong.
  await createNotification(
    'delivery_failed',
    systemic
      ? `⚠️ قناة ${channelLabel} متوقفة`
      : `⚠️ رسالة ${channelLabel} لم تصل`,
    systemic
      ? `فشل الإرسال على القناة كلها: ${String(error?.message || error || '').slice(0, 140)}`
      : `${name ? `${name} — ` : ''}${recipient}: ${String(error?.message || error || '').slice(0, 140)}`,
    {
      outboxId: row.id, channel: row.channel, recipient, refType: row.ref_type || null,
      ...(systemic ? { channelOutage: row.channel } : {}),
    },
    row.tenant_id,
    systemic ? null : staffId,
    // Still unread, the same alert grows a count instead of a new row: an
    // outage stays one line for the day, a run of undelivered messages one
    // line per owner.
    systemic
      ? { coalesceMinutes: 24 * 60, summarize: count => `فشل الإرسال على القناة كلها (${count} مرة النهارده): ${String(error?.message || error || '').slice(0, 120)}` }
      : { coalesceMinutes: 60, summarize: count => `${count} رسالة ${channelLabel} لم تصل — آخرها ${name ? `${name} — ` : ''}${recipient}` },
  );
}

// `skipReason`: the message was held back on purpose (the number wrote «ستوب»
// after the campaign was queued) — the recipient reads 'skipped', and it is
// not counted as a failure, nor does it mark the campaign failed.
async function finalizeCampaign(row, sent, dead, { skipReason = null } = {}) {
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
    if (skipReason) {
      await pool.query(
        `UPDATE whatsapp_campaign_recipients SET status='skipped',skip_reason=?
          WHERE tenant_id=? AND campaign_id=? AND outbox_id=?`,
        [skipReason, row.tenant_id, row.ref_id, row.id]
      ).catch(() => {});
    } else {
      await pool.query(
        `UPDATE whatsapp_campaign_recipients SET status=?
          WHERE tenant_id=? AND campaign_id=? AND outbox_id=?`,
        [sent ? 'sent' : dead ? 'failed' : 'queued', row.tenant_id, row.ref_id, row.id]
      ).catch(() => {});
    }
  }
  if (sent) await pool.query(`UPDATE ${table} SET sent_count=sent_count+1 WHERE id=? AND tenant_id=?`, [row.ref_id, row.tenant_id]);
  if (dead && !skipReason) await pool.query(`UPDATE ${table} SET fail_count=fail_count+1 WHERE id=? AND tenant_id=?`, [row.ref_id, row.tenant_id]);
  const [[remaining]] = await pool.query(
    `SELECT SUM(status IN ('pending','processing','failed')) AS remaining,
            SUM(status='dead' AND COALESCE(last_error,'') NOT LIKE '%opted_out%') AS dead_count
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

// ── Claiming ──────────────────────────────────────────────────────────────────
// A row left in 'processing' for STALE_CLAIM_MINUTES is taken to belong to a
// worker that died, and is claimed again. That used to be a hundred rows at a
// time, sent one by one: a batch slow enough — a provider timing out at 20 s a
// message — still had its tail waiting when the 15 minutes ran out, another
// tick claimed those rows again, and both sent them.
//
// So a few rows are claimed at a time, each claim is refreshed (and checked
// still ours) just before its message goes, and a drain that runs past its time
// hands back what it has not reached. A row is only ever sent by the worker
// whose name is on it at that moment. (The tick itself is guarded too, in
// lib/backgroundScheduler.js — this is what still holds after a crash, or with
// two processes on one database.)
const STALE_CLAIM_MINUTES = 15;
const CLAIM_BATCH = 5;
const DRAIN_BUDGET_MS = 4 * 60 * 1000;

async function claimBatch(workerId, size) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT * FROM message_outbox
        WHERE ((status IN ('pending','failed') AND next_attempt_at<=NOW())
           OR (status='processing' AND locked_at<DATE_SUB(NOW(),INTERVAL ${STALE_CLAIM_MINUTES} MINUTE)))
        ORDER BY next_attempt_at LIMIT ? FOR UPDATE`,
      [size]
    );
    if (rows.length) {
      await conn.query(
        `UPDATE message_outbox SET status='processing',locked_at=NOW(),locked_by=?
          WHERE id IN (${rows.map(() => '?').join(',')})`,
        [workerId, ...rows.map(row => row.id)]
      );
    }
    await conn.commit();
    return rows;
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally { conn.release(); }
}

/** Still ours? Restart the stale clock, right before the send. */
async function refreshClaim(row, workerId) {
  const [result] = await pool.query(
    `UPDATE message_outbox SET locked_at=NOW()
      WHERE id=? AND tenant_id=? AND locked_by=? AND status='processing'`,
    [row.id, row.tenant_id, workerId]
  );
  return result?.affectedRows !== 0;
}

/** Rows claimed but not reached: back in the queue now, not 15 minutes from now. */
async function releaseClaims(rows, workerId) {
  if (!rows.length) return;
  await pool.query(
    `UPDATE message_outbox SET status=IF(attempts>0,'failed','pending'),locked_at=NULL,locked_by=NULL
      WHERE locked_by=? AND status='processing' AND id IN (${rows.map(() => '?').join(',')})`,
    [workerId, ...rows.map(row => row.id)]
  ).catch(error => logger.warn('[outbox] unreached rows not released', error.message));
}

// Not a delivery fault: a decision that stands until a person changes it.
// Retrying MAX_ATTEMPTS times over an hour changes nothing, and leaves rows
// sitting in `failed` as though the provider were at fault, so these die on the
// first attempt. A number that wrote «ستوب» is not a failure to tell anyone
// about either: the message was not supposed to go.
const PERMANENT_REFUSAL = /category_disabled|إرسال هذا النوع من الرسائل موقوف|opted_out/;
const isOptOutRefusal = message => /\bopted_out\b/.test(String(message || ''));

async function deliver(m, senders, workerId) {
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
    return true;
  } catch (e) {
    const attempts = (m.attempts || 0) + 1;
    const permanentlyRefused = PERMANENT_REFUSAL.test(String(e.message || e));
    const dead = permanentlyRefused || attempts >= MAX_ATTEMPTS;
    const backoff = Math.min(60, 2 ** attempts);
    await pool.query(
      `UPDATE message_outbox SET status=?,attempts=?,last_error=?,locked_at=NULL,locked_by=NULL,
         next_attempt_at=DATE_ADD(NOW(),INTERVAL ? MINUTE) WHERE id=? AND tenant_id=? AND locked_by=?`,
      [dead ? 'dead' : 'failed', attempts, String(e.message || e).slice(0, 2000), backoff, m.id, m.tenant_id, workerId]
    );
    if (dead) {
      const optedOut = isOptOutRefusal(e.message || e);
      await finalizeCampaign(m, false, true, optedOut ? { skipReason: 'ألغى الاشتراك' } : {});
      if (!optedOut) {
        await announceDeadLetter(m, e).catch(error =>
          logger.warn('[outbox] dead-letter notice failed', error.message));
      }
    }
    logger.warn('[outbox] delivery failed', { id: m.id, channel: m.channel, attempts, err: e.message });
    return false;
  }
}

/**
 * Drain due rows. `senders` = { email: fn, whatsapp: fn, … }.
 * `limit` is how many messages one drain sends at most — the pace the queue
 * has always kept — claimed CLAIM_BATCH at a time.
 */
async function drain(senders, limit = 20, { budgetMs = DRAIN_BUDGET_MS } = {}) {
  const workerId = `message-${process.pid}-${uuidv4()}`;
  const total = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const deadline = Date.now() + budgetMs;
  let handled = 0;
  let sent = 0;
  while (handled < total && Date.now() < deadline) {
    const rows = await claimBatch(workerId, Math.min(CLAIM_BATCH, total - handled));
    if (!rows.length) break;
    for (const [index, m] of rows.entries()) {
      if (Date.now() >= deadline) {
        await releaseClaims(rows.slice(index), workerId);
        return sent;
      }
      handled += 1;
      // Reclaimed by another worker while this one was busy: theirs now.
      if (!await refreshClaim(m, workerId)) {
        logger.warn('[outbox] claim lost before sending — left to its new owner', { id: m.id });
        continue;
      }
      if (await deliver(m, senders, workerId)) sent += 1;
    }
  }
  return sent;
}

module.exports = {
  enqueue, drain, MAX_ATTEMPTS, CLAIM_BATCH, STALE_CLAIM_MINUTES, finalizeCampaign, announceDeadLetter, isSystemicFailure,
};
