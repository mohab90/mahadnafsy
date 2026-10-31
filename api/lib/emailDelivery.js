'use strict';

// What the mail relay (Brevo) reports about each message, kept and acted on (31 Oct 2026 audit).
//
// The relay answers «accepted» at send time and tells the truth later, on a webhook. Three events mean the address is not
// worth writing to again — a hard bounce (the mailbox does not exist), a block, and a spam complaint — and an unsubscribe
// means it must not be. Those go into marketing_suppressions, the list every campaign already filters through
// (lib/marketingConsent.js filterSuppressed), so a campaign stops mailing a dead address and a complaint stops the next
// message. Receipts and login codes are not marketing and are not held back.

const { pool } = require('./db');
const { destinationHash } = require('./marketingConsent');
const logger = require('./logger').child({ module: 'email-delivery' });

// Brevo's names, transactional and marketing (the latter says «unsubscribe»).
const EVENTS = Object.freeze({
  request: 'sent', delivered: 'delivered', deferred: 'deferred', soft_bounce: 'soft_bounce', hard_bounce: 'hard_bounce',
  blocked: 'blocked', invalid_email: 'hard_bounce', spam: 'spam', complaint: 'spam', unsubscribed: 'unsubscribed',
  unsubscribe: 'unsubscribed', opened: 'opened', unique_opened: 'opened', click: 'click', error: 'error',
});
// The addresses that go on the do-not-mail list.
const SUPPRESS = new Set(['hard_bounce', 'blocked', 'spam', 'unsubscribed']);
// What a person at the institute should hear about.
const PROBLEMS = Object.freeze(['hard_bounce', 'soft_bounce', 'blocked', 'spam', 'error']);

const text = (value, limit) => String(value ?? '').trim().slice(0, limit);

/** A relay's moment as a UTC DATETIME string: epoch seconds, or 'YYYY-MM-DD HH:MM:SS' (Brevo's own clock is UTC+1/+2, so the epoch wins). */
function occurredAt(raw) {
  const epoch = Number(raw.ts_event || raw.ts_epoch || raw.ts);
  const date = Number.isFinite(epoch) && epoch > 1e9
    ? new Date(epoch > 1e12 ? epoch : epoch * 1000)
    : new Date(raw.date || Date.now());
  return (Number.isNaN(date.getTime()) ? new Date() : date).toISOString().slice(0, 19).replace('T', ' ');
}

/** One webhook body (an object, or an array of them) into the rows to keep. Unknown events and rows with no address are dropped. */
function parseEvents(body) {
  const list = Array.isArray(body) ? body : (body && typeof body === 'object' ? [body] : []);
  const out = [];
  for (const raw of list.slice(0, 500)) {
    const event = EVENTS[String(raw?.event || '').trim().toLowerCase()];
    const email = text(raw?.email, 320).toLowerCase();
    if (!event || !/^[^\s@]+@[^\s@]+$/.test(email)) continue;
    out.push({
      messageId: text(raw['message-id'] || raw.message_id || raw.messageId, 255),
      email,
      event,
      reason: text(raw.reason, 500) || null,
      subject: text(raw.subject, 255) || null,
      occurredAt: occurredAt(raw),
    });
  }
  return out;
}

/** Keeps the events (an event the relay retries is one row) and puts the addresses that must not be mailed on the list. */
async function recordEvents(tenantId, events, db = pool) {
  let stored = 0;
  let suppressed = 0;
  for (const item of events) {
    const [result] = await db.query(
      `INSERT IGNORE INTO email_delivery_events (tenant_id, message_id, email, event, reason, subject, occurred_at)
       VALUES (?,?,?,?,?,?,?)`,
      [tenantId, item.messageId, item.email, item.event, item.reason, item.subject, item.occurredAt]);
    stored += Number(result?.affectedRows) || 0;
    if (SUPPRESS.has(item.event)) {
      await db.query(
        `INSERT INTO marketing_suppressions (tenant_id,channel,destination_hash,subject_type,subject_id)
         VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE suppressed_at=suppressed_at`,
        [tenantId, 'email', destinationHash('email', item.email), 'external', 'brevo']);
      suppressed += 1;
    }
  }
  if (events.length) logger.info('[email-delivery] events kept', { received: events.length, stored, suppressed });
  return { received: events.length, stored, suppressed };
}

/** Counts by event over the last `days`, the share that did not arrive, and the addresses that bounced most recently. */
async function summary(tenantId, days = 7, db = pool) {
  const span = Math.min(Math.max(Number(days) || 7, 1), 90);
  const [rows] = await db.query(
    `SELECT event, COUNT(*) AS n FROM email_delivery_events
      WHERE tenant_id=? AND occurred_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY) GROUP BY event`, [tenantId, span]);
  const counts = Object.fromEntries(rows.map(row => [row.event, Number(row.n)]));
  const delivered = counts.delivered || 0;
  const failed = ['hard_bounce', 'blocked', 'spam'].reduce((sum, key) => sum + (counts[key] || 0), 0);
  const [recent] = await db.query(
    `SELECT email, event, reason, subject, occurred_at FROM email_delivery_events
      WHERE tenant_id=? AND event IN ('hard_bounce','blocked','spam','soft_bounce','error')
        AND occurred_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
      ORDER BY occurred_at DESC LIMIT 20`, [tenantId, span]);
  return {
    days: span,
    counts,
    failureShare: delivered + failed ? Math.round((failed / (delivered + failed)) * 1000) / 10 : 0,
    recent: recent.map(row => ({ email: row.email, event: row.event, reason: row.reason, subject: row.subject, at: row.occurred_at })),
  };
}

module.exports = { EVENTS, SUPPRESS, PROBLEMS, parseEvents, recordEvents, summary };
