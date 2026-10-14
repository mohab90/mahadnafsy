'use strict';

/**
 * «قسم الدقي يكون فعال اكثر واقوي وبيبعت اشعار كل يوم لمدير الفرع ومسئول الروند
 * عن الروند ياكد علي المحاضرة ويبعتله العملاء اللى عليها فلوس متاخره» (10 Oct 2026).
 *
 * Every morning from 09:00 Cairo, for each branch: the rounds that meet today —
 * the lecture it is, the time and room — with a reminder to confirm it on the
 * schedule («اشتغلت / اتأجلت»), the clients of the round who still owe money, and
 * the past weeks nobody confirmed. The branch's managers get every round of the
 * branch; the round's reception (reception_id) gets their own. One WhatsApp per
 * person a day (staff_alert — the institute's own staff, lib/whatsapp.js).
 */

const { getDaqqiAttendees } = require('./daqqiAttendees');
const { attachAttendeeMoney } = require('./daqqiAttendeeMoney');
const { lectureToday } = require('./daqqiLecture');
const { cairoClock, cairoToday } = require('./dates');
const { weekKey } = require('./dokkiWeeklyReport');
const outbox = require('./outbox');

const BRANCH_LABEL = { DAQQI: 'الدقي', TAGAMOA: 'التجمع' };
const MANAGER_ROLE = { DAQQI: 'DAQQI_MANAGER', TAGAMOA: 'TAGAMOA_MANAGER' };
const SLOT_LABEL = { MORNING: 'صباحي', NOON: 'ضهر', EVENING: 'مسائي' };
const SEND_FROM_MINUTES = 9 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const tryJson = (value, fallback) => { try { return JSON.parse(value || ''); } catch { return fallback; } };
const ymd = value => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10));
const n = value => Math.round(Number(value) || 0).toLocaleString('en-US');

/** Does the round meet today? Weekly from its start date. */
function meetsToday(startDate, today) {
  const start = Date.parse(ymd(startDate));
  if (!Number.isFinite(start)) return false;
  const days = Math.round((Date.parse(today) - start) / DAY_MS);
  return days >= 0 && days % 7 === 0;
}

/** The branch's rounds meeting today, each with the clients who still owe. */
async function buildDokkiDailyBrief(db, { tenantId, branch = 'DAQQI', today = cairoToday() }) {
  const [rounds] = await db.query(
    `SELECT r.id, r.code, r.start_date, r.time_slot, r.room, r.reception_id, r.reception_name, r.instructor_name,
            r.postponed_weeks_json, r.held_weeks_json, c.price_egp, COALESCE(NULLIF(c.title_ar, ''), c.title) AS course_title
       FROM daqqi_rounds r LEFT JOIN courses c ON c.id = r.course_id AND c.tenant_id = r.tenant_id
      WHERE r.tenant_id = ? AND r.branch = ? AND r.status <> 'FINISHED'
      ORDER BY FIELD(r.time_slot, 'MORNING', 'NOON', 'EVENING'), r.code`, [tenantId, branch]);
  const todays = rounds.filter(round => meetsToday(round.start_date, today));
  if (!todays.length) return { branch, branchLabel: BRANCH_LABEL[branch] || branch, today, rounds: [] };
  const attendees = await attachAttendeeMoney(db, tenantId, await getDaqqiAttendees(db, tenantId, todays.map(round => round.id)));
  const thisWeek = weekKey(today);
  return {
    branch, branchLabel: BRANCH_LABEL[branch] || branch, today,
    rounds: todays.map(round => {
      const postponed = tryJson(round.postponed_weeks_json, []);
      const held = tryJson(round.held_weeks_json, []);
      const lecture = Math.max(1, lectureToday(ymd(round.start_date), postponed, today));
      const people = attendees.filter(row => row.round_id === round.id && !Number(row.archived || 0));
      // The same sum the weekly report and the schedule's «المتبقي» make.
      const owing = people.map(row => {
        const price = row.agreed_price != null ? Number(row.agreed_price) : Number(round.price_egp) || 0;
        const left = price - Number(row.amount_paid || 0) - Number(row.prior_paid || 0) - Number(row.unlinked_applied || 0);
        return { name: row.name || '', phone: row.phone || '', left: Math.round(left) };
      }).filter(row => row.left > 0).sort((a, b) => b.left - a.left);
      return {
        id: round.id, code: round.code, course: round.course_title || '', slot: SLOT_LABEL[round.time_slot] || '', room: round.room || '',
        receptionId: round.reception_id || null, reception: round.reception_name || '', lecturer: round.instructor_name || '',
        lecture, clients: people.length, owing,
        // Weeks before this one that nobody confirmed — the lecturer's fee follows them.
        unconfirmedBefore: Math.max(0, lecture - 1 - held.filter(week => week !== thisWeek).length),
      };
    }),
  };
}

function composeRound(round) {
  const lines = [
    `📚 *روند ${round.code}* — ${round.course}`,
    `النهارده المحاضرة ${round.lecture}${round.slot ? ` · ${round.slot}` : ''}${round.room ? ` · ${round.room}` : ''}${round.lecturer ? ` · د. ${round.lecturer}` : ''} · ${n(round.clients)} عميل`,
    '✅ بعد المحاضرة أكّدها من جدول الفرع: «اشتغلت» أو «اتأجلت».',
  ];
  if (round.unconfirmedBefore) lines.push(`⚠️ ${n(round.unconfirmedBefore)} أسبوع قبل كده محدش أكّده.`);
  if (round.owing.length) {
    const total = round.owing.reduce((sum, row) => sum + row.left, 0);
    lines.push(`💰 عليهم فلوس (${n(round.owing.length)} عميل · ${n(total)} ج.م):`);
    for (const row of round.owing.slice(0, 15)) lines.push(`• ${row.name}${row.phone ? ` ${row.phone}` : ''} — باقي ${n(row.left)}`);
    if (round.owing.length > 15) lines.push(`… و${n(round.owing.length - 15)} كمان في جدول الفرع`);
  } else {
    lines.push('💰 مفيش حد عليه فلوس 👌');
  }
  return lines.join('\n');
}

function composeDokkiDailyBrief(brief, rounds = brief.rounds) {
  return [`☀️ *محاضرات ${brief.branchLabel} النهارده — ${brief.today}*`, `${n(rounds.length)} روند`, '', rounds.map(composeRound).join('\n\n')]
    .join('\n').trim();
}

/** From 09:00 Cairo: each branch's managers get the day's rounds, each reception their own. Once a day each. */
async function sendDueDokkiDailyBriefs(db, { tenantId, now = new Date() }) {
  if (!(await require('./dokkiAbsenceFollowUp').dokkiAutomationSettings(tenantId)).dailyBrief) return 0;
  const clock = cairoClock(now);
  if (clock.minutes < SEND_FROM_MINUTES) return 0;
  let sent = 0;
  for (const branch of Object.keys(MANAGER_ROLE)) {
    const brief = await buildDokkiDailyBrief(db, { tenantId, branch, today: clock.date });
    if (!brief.rounds.length) continue;
    const receptionIds = [...new Set(brief.rounds.map(round => round.receptionId).filter(Boolean))];
    const [people] = await db.query(
      `SELECT id, name, phone, UPPER(role) AS role FROM staff
        WHERE tenant_id = ? AND is_active = 1 AND deleted_at IS NULL
          AND (UPPER(role) = ?${receptionIds.length ? ` OR id IN (${receptionIds.map(() => '?').join(',')})` : ''})`,
      [tenantId, MANAGER_ROLE[branch], ...receptionIds]);
    for (const person of people) {
      if (!person.phone) continue;
      const mine = person.role === MANAGER_ROLE[branch] ? brief.rounds : brief.rounds.filter(round => round.receptionId === person.id);
      if (!mine.length) continue;
      const queued = await outbox.enqueue({
        channel: 'whatsapp', recipient: person.phone, tenantId,
        dedupeKey: `dokki-daily:${tenantId}:${branch}:${clock.date}:${person.id}`, refType: 'daqqi_daily', refId: clock.date,
        payload: { message: composeDokkiDailyBrief(brief, mine), category: 'staff_alert' },
      }, db);
      if (queued) sent += 1;
    }
  }
  return sent;
}

module.exports = { buildDokkiDailyBrief, composeDokkiDailyBrief, meetsToday, sendDueDokkiDailyBriefs };
