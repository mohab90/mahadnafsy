'use strict';

// A lecturer's consultation hours (25 Oct 2026): «الأوقات اللي المحاضر بيحددها تتكرر كل أسبوع … ويقدر يقفل يوم معين».
//
// A slot is a weekday and an hour (therapist_slots), so it repeats every week by itself — there is no one-off date to
// run out. What a lecturer adds on top is the exception: a day they are away (therapist_blocked_dates), on which none
// of their slots can be booked. The booking checks both (routes/lead-capture-crm.js, lib/consultationRequests.js).

const { uuidv4 } = require('./id');
const { cairoToday, isValidDateOnly } = require('./dates');

const WEEKDAYS = Object.freeze(['saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday']);
const MAX_SLOTS = 60;
const MAX_BLOCKED_AHEAD = 366;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

const minutes = time => { const [h, m] = String(time).split(':').map(Number); return h * 60 + m; };
const fail = (error, code) => Object.assign(new Error(error), { statusCode: 400, code });

/**
 * The weekly slots a lecturer sent, checked: a known weekday, an hour that ends after it starts, no two overlapping on
 * the same day. Returns them clean, in week order.
 */
function normalizeSlots(input) {
  if (!Array.isArray(input)) throw fail('المواعيد لازم تتبعت كقايمة', 'SLOTS_INVALID');
  if (input.length > MAX_SLOTS) throw fail(`أقصى عدد مواعيد في الأسبوع ${MAX_SLOTS}`, 'SLOTS_TOO_MANY');
  const slots = input.map(raw => {
    const day = String(raw?.day || '').toLowerCase();
    const start = String(raw?.startTime ?? raw?.start_time ?? '').slice(0, 5);
    const end = String(raw?.endTime ?? raw?.end_time ?? '').slice(0, 5);
    if (!WEEKDAYS.includes(day)) throw fail('اليوم لازم يكون من أيام الأسبوع', 'SLOT_DAY');
    if (!TIME.test(start) || !TIME.test(end)) throw fail('الساعة لازم تتكتب بالشكل 18:30', 'SLOT_TIME');
    if (minutes(end) <= minutes(start)) throw fail('نهاية الموعد لازم تبقى بعد بدايته', 'SLOT_ORDER');
    const link = String(raw?.meetingLink ?? raw?.meeting_link ?? '').trim();
    if (link && !/^https?:\/\//i.test(link)) throw fail('رابط الجلسة لازم يبدأ بـ https://', 'SLOT_LINK');
    return {
      id: String(raw?.id || '').slice(0, 36) || null, day, startTime: start, endTime: end,
      timezone: String(raw?.timezone || 'Africa/Cairo').slice(0, 100), label: String(raw?.label || '').trim().slice(0, 255) || null,
      meetingLink: link.slice(0, 2000) || null,
    };
  });
  slots.sort((a, b) => WEEKDAYS.indexOf(a.day) - WEEKDAYS.indexOf(b.day) || minutes(a.startTime) - minutes(b.startTime));
  for (let i = 1; i < slots.length; i += 1) {
    if (slots[i].day === slots[i - 1].day && minutes(slots[i].startTime) < minutes(slots[i - 1].endTime)) {
      throw fail('في موعدين متداخلين في نفس اليوم', 'SLOT_OVERLAP');
    }
  }
  return slots;
}

/**
 * Make the lecturer's active weekly slots exactly `slots`. A slot that keeps its id is updated in place (a booking
 * remembers its slot id); a new one is added; one that is gone is switched off, not deleted, so past bookings still
 * name an hour that existed.
 */
async function replaceWeeklySlots(db, { tenantId, therapistId, slots }) {
  const [existing] = await db.query(
    `SELECT s.id FROM therapist_slots s JOIN therapists t ON t.id = s.therapist_id
      WHERE s.therapist_id=? AND t.tenant_id=?`, [therapistId, tenantId]);
  const known = new Set(existing.map(row => row.id));
  const keep = new Set();
  for (const slot of slots) {
    if (slot.id && known.has(slot.id)) {
      keep.add(slot.id);
      await db.query(
        `UPDATE therapist_slots s JOIN therapists t ON t.id = s.therapist_id AND t.tenant_id=?
            SET s.day=?, s.start_time=?, s.end_time=?, s.timezone=?, s.label=?, s.meeting_link=?, s.is_active=1
          WHERE s.id=? AND s.therapist_id=?`,
        [tenantId, slot.day, slot.startTime, slot.endTime, slot.timezone, slot.label, slot.meetingLink, slot.id, therapistId]);
    } else {
      const id = uuidv4();
      keep.add(id);
      await db.query(
        `INSERT INTO therapist_slots (id, therapist_id, day, start_time, end_time, timezone, label, meeting_link, is_active)
         VALUES (?,?,?,?,?,?,?,?,1)`,
        [id, therapistId, slot.day, slot.startTime, slot.endTime, slot.timezone, slot.label, slot.meetingLink]);
    }
  }
  const gone = [...known].filter(id => !keep.has(id));
  if (gone.length) {
    await db.query(
      `UPDATE therapist_slots s JOIN therapists t ON t.id = s.therapist_id AND t.tenant_id=?
          SET s.is_active=0 WHERE s.therapist_id=? AND s.id IN (${gone.map(() => '?').join(',')})`,
      [tenantId, therapistId, ...gone]);
  }
  return slots.length;
}

/** The days a lecturer is away from today on (Cairo), soonest first. */
async function blockedDatesOf(db, { tenantId, therapistId, from = cairoToday() }) {
  const [rows] = await db.query(
    `SELECT id, DATE_FORMAT(blocked_date, '%Y-%m-%d') AS blocked_date, reason FROM therapist_blocked_dates
      WHERE tenant_id=? AND therapist_id=? AND blocked_date >= ? ORDER BY blocked_date LIMIT 400`,
    [tenantId, therapistId, from]);
  return rows.map(row => ({ id: row.id, date: row.blocked_date, reason: row.reason || '' }));
}

/** The upcoming blocked days of several lecturers, as { therapistId: ['YYYY-MM-DD', …] } — what the booking page greys out. */
async function blockedDatesByTherapist(db, { tenantId, therapistIds, from = cairoToday() }) {
  if (!therapistIds.length) return {};
  const [rows] = await db.query(
    `SELECT therapist_id, DATE_FORMAT(blocked_date, '%Y-%m-%d') AS blocked_date FROM therapist_blocked_dates
      WHERE tenant_id=? AND blocked_date >= ? AND therapist_id IN (${therapistIds.map(() => '?').join(',')}) ORDER BY blocked_date`,
    [tenantId, from, ...therapistIds]);
  const out = {};
  for (const row of rows) (out[row.therapist_id] ||= []).push(row.blocked_date);
  return out;
}

async function isDayBlocked(db, { tenantId, therapistId, date }) {
  if (!therapistId || !isValidDateOnly(date)) return false;
  const [[row]] = await db.query(
    'SELECT 1 AS ok FROM therapist_blocked_dates WHERE tenant_id=? AND therapist_id=? AND blocked_date=? LIMIT 1',
    [tenantId, therapistId, date]);
  return Boolean(row);
}

async function blockDay(db, { tenantId, therapistId, date, reason = '', actor = null }) {
  if (!isValidDateOnly(date)) throw fail('التاريخ لازم يتكتب بالشكل 2026-11-02', 'BLOCK_DATE');
  const today = cairoToday();
  if (date < today) throw fail('مينفعش تقفل يوم عدّى', 'BLOCK_PAST');
  const [[count]] = await db.query(
    'SELECT COUNT(*) AS n FROM therapist_blocked_dates WHERE tenant_id=? AND therapist_id=? AND blocked_date >= ?', [tenantId, therapistId, today]);
  if (Number(count?.n) >= MAX_BLOCKED_AHEAD) throw fail('وصلت للحد الأقصى من الأيام المقفولة', 'BLOCK_TOO_MANY');
  await db.query(
    `INSERT INTO therapist_blocked_dates (id, tenant_id, therapist_id, blocked_date, reason, created_by)
     VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE reason=VALUES(reason)`,
    [uuidv4(), tenantId, therapistId, date, String(reason || '').trim().slice(0, 255) || null, actor]);
  // Bookings already made on that day are not cancelled: the lecturer is told how many to move.
  const [[booked]] = await db.query(
    `SELECT COUNT(*) AS n FROM consultations
      WHERE tenant_id=? AND therapist_id=? AND deleted_at IS NULL AND status IN ('PENDING','CONFIRMED') AND DATE(session_date)=?`,
    [tenantId, therapistId, date]);
  return { alreadyBooked: Number(booked?.n) || 0 };
}

async function unblockDay(db, { tenantId, therapistId, id }) {
  const [result] = await db.query(
    'DELETE FROM therapist_blocked_dates WHERE id=? AND tenant_id=? AND therapist_id=?', [id, tenantId, therapistId]);
  return result.affectedRows > 0;
}

module.exports = {
  MAX_SLOTS, WEEKDAYS,
  blockDay, blockedDatesByTherapist, blockedDatesOf, isDayBlocked, normalizeSlots, replaceWeeklySlots, unblockDay,
};
