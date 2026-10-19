'use strict';

// Scheduled messages and chat campaigns, sent from a rep's own linked WhatsApp (migration 298).
//
// «رسائل مجدولة» and «حملات من الشات» (19 Oct 2026). One row per message with the time it is due. A campaign is a batch
// of rows spaced apart (a burst of identical messages is what gets a number banned), and it is dropped for anyone who
// asked not to be messaged (lib/marketingConsent.js). The worker below sends what is due through sendText, which paces
// every send and stops at the rep's daily cap — a message that meets the cap waits for tomorrow instead of failing.
//
// Times are the database's own clock (NOW() plus a delay in seconds), so the server's time zone never skews them.

const { pool } = require('./db');
const { uuidv4 } = require('./id');
const logger = require('./logger').child({ module: 'wa-web-scheduled' });
const { jidForPhone, phoneOfJid } = require('./whatsappWebStore');
const { toDialable } = require('./phoneNumber');
const { isSuppressed } = require('./marketingConsent');

const MAX_PENDING_PER_REP = 600;
const MAX_CAMPAIGN = 200;
const MIN_GAP_SECONDS = 20;
const MAX_AHEAD_SECONDS = 60 * 86400;
const MAX_ATTEMPTS = 4;
const RETRY_NOT_LINKED_SECONDS = 600;

class ScheduleError extends Error {
  constructor(status, message, code) { super(message); this.statusCode = status; this.code = code; }
}

/** Seconds from now to `when` (a Date or ISO text); never negative. */
function secondsUntil(when, now = Date.now()) {
  const target = when instanceof Date ? when.getTime() : new Date(when).getTime();
  if (!Number.isFinite(target)) throw new ScheduleError(400, 'الوقت غير صحيح', 'WA_SCHED_TIME');
  return Math.max(0, Math.round((target - now) / 1000));
}

/** The recipient as stored: the chat address when it is one, else the number's address. */
function recipientOf({ jid, phone }) {
  const address = jid ? String(jid) : jidForPhone(phone);
  if (!address || !/@(s\.whatsapp\.net|lid)$/.test(address)) throw new ScheduleError(400, 'الرقم مش صالح للإرسال', 'WA_SCHED_RECIPIENT');
  return { jid: address, phone: phoneOfJid(address) || toDialable(phone) || null };
}

async function pendingCount(tenantId, staffId) {
  const [[row]] = await pool.query(
    "SELECT COUNT(*) AS n FROM wa_web_scheduled WHERE tenant_id=? AND staff_id=? AND status IN ('pending','sending')", [tenantId, staffId]);
  return Number(row.n) || 0;
}

/** One message at a time chosen by the rep. */
async function scheduleOne(tenantId, staffId, { jid, phone, name, text, sendAt }) {
  const body = String(text || '').trim();
  if (!body) throw new ScheduleError(400, 'اكتب الرسالة الأول', 'WA_SCHED_EMPTY');
  if (body.length > 4000) throw new ScheduleError(400, 'الرسالة طويلة جداً', 'WA_SCHED_LONG');
  const delay = secondsUntil(sendAt);
  if (delay < 30) throw new ScheduleError(400, 'اختار وقت بعد دقيقة على الأقل', 'WA_SCHED_TIME');
  if (delay > MAX_AHEAD_SECONDS) throw new ScheduleError(400, 'أقصى جدولة 60 يوم قدام', 'WA_SCHED_TIME');
  if ((await pendingCount(tenantId, staffId)) >= MAX_PENDING_PER_REP) throw new ScheduleError(409, 'عندك رسائل مجدولة كتير — الغي منها الأول', 'WA_SCHED_FULL');
  const to = recipientOf({ jid, phone });
  const id = uuidv4();
  await pool.query(
    `INSERT INTO wa_web_scheduled (id, tenant_id, staff_id, jid, phone, name, body, send_at)
     VALUES (?,?,?,?,?,?,?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
    [id, tenantId, staffId, to.jid, to.phone, name ? String(name).slice(0, 255) : null, body, delay]);
  return { id, jid: to.jid, sendInSeconds: delay };
}

/**
 * A message to many chats, one after another. `{name}` is each person's first name. People who unsubscribed and numbers
 * that are not addressable are left out and counted.
 * @returns {{ batchId: string, queued: number, skipped: { unsubscribed: number, invalid: number, duplicate: number }, lastInSeconds: number }}
 */
async function scheduleCampaign(tenantId, staffId, { recipients, text, startAt, gapSeconds, label }) {
  const body = String(text || '').trim();
  if (!body) throw new ScheduleError(400, 'اكتب الرسالة الأول', 'WA_SCHED_EMPTY');
  if (body.length > 4000) throw new ScheduleError(400, 'الرسالة طويلة جداً', 'WA_SCHED_LONG');
  const list = Array.isArray(recipients) ? recipients : [];
  if (!list.length) throw new ScheduleError(400, 'اختار محادثات الأول', 'WA_SCHED_NONE');
  if (list.length > MAX_CAMPAIGN) throw new ScheduleError(400, `أقصى حملة ${MAX_CAMPAIGN} محادثة في المرة`, 'WA_SCHED_MANY');
  const start = startAt ? secondsUntil(startAt) : 0;
  if (start > MAX_AHEAD_SECONDS) throw new ScheduleError(400, 'أقصى جدولة 60 يوم قدام', 'WA_SCHED_TIME');
  const gap = Math.max(MIN_GAP_SECONDS, Math.min(600, Math.round(Number(gapSeconds) || 45)));
  if ((await pendingCount(tenantId, staffId)) + list.length > MAX_PENDING_PER_REP) {
    throw new ScheduleError(409, 'عندك رسائل مجدولة كتير — الغي منها الأول', 'WA_SCHED_FULL');
  }

  const skipped = { unsubscribed: 0, invalid: 0, duplicate: 0 };
  const seen = new Set();
  const rows = [];
  for (const recipient of list) {
    let to;
    try { to = recipientOf(recipient || {}); } catch { skipped.invalid += 1; continue; }
    if (seen.has(to.jid)) { skipped.duplicate += 1; continue; }
    seen.add(to.jid);
    if (to.phone && await isSuppressed(tenantId, 'whatsapp', to.phone).catch(() => false)) { skipped.unsubscribed += 1; continue; }
    rows.push({ ...to, name: recipient.name ? String(recipient.name).slice(0, 255) : null });
  }
  const batchId = uuidv4();
  let at = start;
  for (const row of rows) {
    // ±30% so the spacing is not a metronome.
    at += Math.round(gap * (0.7 + Math.random() * 0.6));
    const first = String(row.name || '').trim().split(/\s+/)[0] || '';
    await pool.query(
      `INSERT INTO wa_web_scheduled (id, tenant_id, staff_id, jid, phone, name, body, send_at, batch_id, batch_label)
       VALUES (?,?,?,?,?,?,?, DATE_ADD(NOW(), INTERVAL ? SECOND), ?, ?)`,
      [uuidv4(), tenantId, staffId, row.jid, row.phone, row.name, body.replace(/\{name\}/g, first), at, batchId, label ? String(label).slice(0, 160) : null]);
  }
  return { batchId, queued: rows.length, skipped, lastInSeconds: at };
}

/** The rep's own waiting messages (for one chat, or all). */
async function listPending(tenantId, staffId, { jid } = {}) {
  const params = [tenantId, staffId];
  let where = "status IN ('pending','sending')";
  if (jid) { where += ' AND jid=?'; params.push(jid); }
  const [rows] = await pool.query(
    `SELECT id, jid, phone, name, body, status, batch_id AS batchId, batch_label AS batchLabel, attempts, error,
            UNIX_TIMESTAMP(send_at) * 1000 AS sendAtMs
       FROM wa_web_scheduled WHERE tenant_id=? AND staff_id=? AND ${where} ORDER BY send_at ASC LIMIT 200`, params);
  return rows.map(row => ({ ...row, sendAtMs: Number(row.sendAtMs) }));
}

async function cancel(tenantId, staffId, id) {
  const [result] = await pool.query(
    "UPDATE wa_web_scheduled SET status='canceled' WHERE tenant_id=? AND staff_id=? AND id=? AND status='pending'", [tenantId, staffId, id]);
  return result.affectedRows > 0;
}

async function cancelBatch(tenantId, staffId, batchId) {
  const [result] = await pool.query(
    "UPDATE wa_web_scheduled SET status='canceled' WHERE tenant_id=? AND staff_id=? AND batch_id=? AND status='pending'", [tenantId, staffId, batchId]);
  return result.affectedRows;
}

/** The rep's recent campaigns with how far each got. */
async function listCampaigns(tenantId, staffId) {
  const [rows] = await pool.query(
    `SELECT batch_id AS batchId, MAX(batch_label) AS label, COUNT(*) AS total,
            SUM(status='sent') AS sent, SUM(status IN ('pending','sending')) AS waiting, SUM(status='failed') AS failed, SUM(status='canceled') AS canceled,
            UNIX_TIMESTAMP(MIN(created_at)) * 1000 AS createdMs, UNIX_TIMESTAMP(MAX(send_at)) * 1000 AS lastMs
       FROM wa_web_scheduled WHERE tenant_id=? AND staff_id=? AND batch_id IS NOT NULL
      GROUP BY batch_id ORDER BY MIN(created_at) DESC LIMIT 20`, [tenantId, staffId]);
  return rows.map(row => ({
    batchId: row.batchId, label: row.label || null, total: Number(row.total) || 0, sent: Number(row.sent) || 0, waiting: Number(row.waiting) || 0,
    failed: Number(row.failed) || 0, canceled: Number(row.canceled) || 0, createdMs: Number(row.createdMs), lastMs: Number(row.lastMs),
  }));
}

let running = false;

/**
 * Send what is due. `wa` is lib/whatsappWeb.js (passed in so this file can be exercised without a connection).
 * A message the cap holds back waits for the next morning; one for a rep whose phone is not linked retries shortly.
 */
async function runDue(wa, { limit = 10 } = {}) {
  if (running || !wa.isOwner()) return 0;
  running = true;
  let handled = 0;
  try {
    const [due] = await pool.query(
      "SELECT id, tenant_id, staff_id, jid, body, attempts FROM wa_web_scheduled WHERE status='pending' AND send_at <= NOW() ORDER BY send_at ASC LIMIT ?", [limit]);
    for (const row of due) {
      const [claim] = await pool.query("UPDATE wa_web_scheduled SET status='sending', attempts=attempts+1 WHERE id=? AND tenant_id=? AND status='pending'", [row.id, row.tenant_id]);
      if (!claim.affectedRows) continue;
      handled += 1;
      try {
        await wa.sendText(row.tenant_id, row.staff_id, { jid: row.jid, text: row.body });
        await pool.query("UPDATE wa_web_scheduled SET status='sent', sent_at=NOW(), error=NULL WHERE id=? AND tenant_id=?", [row.id, row.tenant_id]);
      } catch (error) {
        const code = error?.code || '';
        if (code === 'WA_WEB_DAILY_LIMIT') {
          // The cap protects the number: this one goes out tomorrow morning (nine hours on from midnight, Cairo's day starts there).
          await pool.query("UPDATE wa_web_scheduled SET status='pending', attempts=attempts-1, error=?, send_at=DATE_ADD(DATE(DATE_ADD(NOW(), INTERVAL 1 DAY)), INTERVAL 9 HOUR) WHERE id=? AND tenant_id=?",
            ['الحد اليومي — هتتبعت بكرة', row.id, row.tenant_id]);
        } else if ((code === 'WA_WEB_NOT_LINKED' || code === 'WA_WEB_BUSY') && row.attempts + 1 < 12) {
          await pool.query("UPDATE wa_web_scheduled SET status='pending', error=?, send_at=DATE_ADD(NOW(), INTERVAL ? SECOND) WHERE id=? AND tenant_id=?",
            ['الواتساب مش مربوط — هيحاول تاني', RETRY_NOT_LINKED_SECONDS, row.id, row.tenant_id]);
        } else if (!error?.statusCode && row.attempts + 1 < MAX_ATTEMPTS) {
          await pool.query("UPDATE wa_web_scheduled SET status='pending', error=?, send_at=DATE_ADD(NOW(), INTERVAL 120 SECOND) WHERE id=? AND tenant_id=?", [String(error?.message || 'خطأ').slice(0, 250), row.id, row.tenant_id]);
        } else {
          await pool.query("UPDATE wa_web_scheduled SET status='failed', error=? WHERE id=? AND tenant_id=?", [String(error?.message || 'فشل الإرسال').slice(0, 250), row.id, row.tenant_id]);
        }
        logger.warn('[wa-web scheduled] not sent', { id: row.id, code, error: error?.message });
      }
    }
  } finally { running = false; }
  return handled;
}

module.exports = {
  ScheduleError, MAX_CAMPAIGN, MAX_PENDING_PER_REP, MIN_GAP_SECONDS,
  secondsUntil, recipientOf, scheduleOne, scheduleCampaign, listPending, cancel, cancelBatch, listCampaigns, runDue,
};
