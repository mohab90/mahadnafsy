'use strict';

/**
 * «تقرير أسبوعي لمدير الدقي: الحضور، والأسابيع اللي ماتأكدتش، والمتبقي على كل
 * روند» (9 Oct 2026). Every running round of a branch: its clients, how many came
 * this week, the lecture it is on, the weeks nobody answered «اشتغلت / اتأجلت»
 * (the lecturer's fee follows them), and what its clients still owe. Read on the
 * branch's statistics screen, and sent on WhatsApp to the branch's managers every
 * Saturday morning — a message to the institute's own staff (category
 * staff_alert, lib/whatsapp.js).
 */

const { getDaqqiAttendees } = require('./daqqiAttendees');
const { attachAttendeeMoney } = require('./daqqiAttendeeMoney');
const { lectureToday } = require('./daqqiLecture');
const { addDaysToDateOnly, cairoClock, cairoToday } = require('./dates');
const outbox = require('./outbox');

const BRANCH_LABEL = { DAQQI: 'الدقي', TAGAMOA: 'التجمع' };
const MANAGER_ROLE = { DAQQI: 'DAQQI_MANAGER', TAGAMOA: 'TAGAMOA_MANAGER' };
const tryJson = (value, fallback) => { try { return JSON.parse(value || ''); } catch { return fallback; } };
const ymd = value => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10));
/** Monday of this Cairo week — the schedule's own week key (cairoWeekStart(1)). */
function weekKey(today = cairoToday()) {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDaysToDateOnly(today, -((weekday + 6) % 7));
}

async function buildDokkiWeeklyReport(db, { tenantId, branch = 'DAQQI', today = cairoToday(), now = new Date() }) {
  const [rounds] = await db.query(
    `SELECT r.id, r.code, r.start_date, r.status, r.reception_name, r.instructor_name, r.postponed_weeks_json, r.held_weeks_json,
            c.price_egp, COALESCE(NULLIF(c.title_ar, ''), c.title) AS course_title
       FROM daqqi_rounds r LEFT JOIN courses c ON c.id = r.course_id AND c.tenant_id = r.tenant_id
      WHERE r.tenant_id = ? AND r.branch = ? AND r.status <> 'FINISHED'
      ORDER BY r.start_date`, [tenantId, branch]);
  const thisWeek = weekKey(today);
  const attendees = rounds.length
    ? await attachAttendeeMoney(db, tenantId, await getDaqqiAttendees(db, tenantId, rounds.map(round => round.id)))
    : [];
  // «حضر الأسبوع ده»: the last seven days. The table has marked_at (UTC), not
  // created_at — the query failed and the report never opened — and a Monday
  // window sent on Saturday morning lost every Saturday-afternoon and Sunday class.
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const [marks] = rounds.length ? await db.query(
    `SELECT round_id, COUNT(DISTINCT subscriber_id) AS came FROM daqqi_attendance_events
      WHERE tenant_id = ? AND round_id IN (${rounds.map(() => '?').join(',')}) AND marked_at >= ? AND status = 'PRESENT'
      GROUP BY round_id`, [tenantId, ...rounds.map(round => round.id), since]) : [[]];
  const cameThisWeek = new Map(marks.map(row => [row.round_id, Number(row.came) || 0]));
  const rows = rounds.map(round => {
    const people = attendees.filter(row => row.round_id === round.id && !Number(row.archived || 0));
    const postponed = tryJson(round.postponed_weeks_json, []);
    const held = tryJson(round.held_weeks_json, []);
    const started = ymd(round.start_date) <= today;
    const lecture = started ? Math.max(1, lectureToday(ymd(round.start_date), postponed, today)) : 0;
    let owed = 0;
    let owing = 0;
    for (const row of people) {
      const price = row.agreed_price != null ? Number(row.agreed_price) : Number(round.price_egp) || 0;
      const left = price - Number(row.amount_paid || 0) - Number(row.prior_paid || 0) - Number(row.unlinked_applied || 0);
      if (price > 0 && left > 0) { owed += left; owing += 1; }
    }
    return {
      id: round.id, code: round.code, course: round.course_title || '', reception: round.reception_name || '', lecturer: round.instructor_name || '',
      clients: people.length, came: cameThisWeek.get(round.id) || 0, lecture,
      // Weeks since it began that nobody answered, this one included when unanswered.
      unconfirmedWeeks: started ? Math.max(0, lecture - held.length) : 0,
      thisWeekAnswered: held.includes(thisWeek) || postponed.includes(thisWeek),
      owed: Math.round(owed), owing,
    };
  });
  const sum = key => rows.reduce((total, row) => total + row[key], 0);
  return {
    branch, branchLabel: BRANCH_LABEL[branch] || branch, week: thisWeek, rounds: rows,
    totals: { rounds: rows.length, clients: sum('clients'), came: sum('came'), unconfirmedWeeks: sum('unconfirmedWeeks'), owed: sum('owed'), owing: sum('owing') },
  };
}

const n = value => Math.round(Number(value) || 0).toLocaleString('en-US');

function composeDokkiWeeklyReport(report) {
  const { totals } = report;
  return [
    `📋 *تقرير ${report.branchLabel} الأسبوعي — أسبوع ${report.week}*`,
    `${n(totals.rounds)} روند شغال · ${n(totals.clients)} عميل · حضر الأسبوع ده ${n(totals.came)}`,
    totals.unconfirmedWeeks ? `⚠️ أسابيع محدش أكّدها (اشتغلت/اتأجلت): ${n(totals.unconfirmedWeeks)} — أجر المحاضر بيتحسب منها` : '✅ كل الأسابيع متأكدة',
    `💰 المتبقي على العملاء: ${n(totals.owed)} ج.م (${n(totals.owing)} عميل)`,
    '',
    ...report.rounds.map(row => `• روند ${row.code} — ${row.course}${row.reception ? ` (${row.reception})` : ''}: م${row.lecture} · حضر ${row.came}/${row.clients}`
      + `${row.unconfirmedWeeks ? ` · ${row.unconfirmedWeeks} أسبوع مش متأكد` : ''}${row.owed ? ` · متبقي ${n(row.owed)} ج.م` : ''}`),
  ].join('\n').trim();
}

/** Saturday from 10:00 Cairo: send this week's report to each branch's managers, once. */
async function sendDueDokkiWeeklyReports(db, { tenantId, now = new Date() }) {
  if (!(await require('./dokkiAbsenceFollowUp').dokkiAutomationSettings(tenantId)).weeklyReport) return 0;
  const clock = cairoClock(now);
  const weekday = new Date(`${clock.date}T00:00:00Z`).getUTCDay();
  if (weekday !== 6 || clock.minutes < 10 * 60) return 0;
  let sent = 0;
  for (const branch of Object.keys(MANAGER_ROLE)) {
    const [managers] = await db.query(
      `SELECT id, name, phone FROM staff WHERE tenant_id = ? AND role = ? AND is_active = 1 AND deleted_at IS NULL`,
      [tenantId, MANAGER_ROLE[branch]]);
    if (!managers.length) continue;
    const report = await buildDokkiWeeklyReport(db, { tenantId, branch, today: clock.date, now });
    if (!report.rounds.length) continue;
    const text = composeDokkiWeeklyReport(report);
    for (const manager of managers) {
      const key = `dokki-weekly:${tenantId}:${branch}:${report.week}:${manager.id}`;
      if (manager.phone) {
        const queued = await outbox.enqueue({
          channel: 'whatsapp', recipient: manager.phone, tenantId, dedupeKey: key, refType: 'daqqi_weekly', refId: report.week,
          payload: { message: text, category: 'staff_alert' },
        }, db);
        if (queued) sent += 1;
      }
    }
  }
  return sent;
}

module.exports = { buildDokkiWeeklyReport, composeDokkiWeeklyReport, sendDueDokkiWeeklyReports, weekKey };
