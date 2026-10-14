'use strict';

// «تقرير أسبوعي لمدير الدقي: الحضور، والأسابيع اللي ماتأكدتش، والمتبقي على كل
// روند · الواتساب يتابع لوحده أي عميل غاب محاضرتين … نوقفها شوية» (9 Oct 2026).

const test = require('node:test');
const assert = require('node:assert/strict');

const outboxed = [];
let automation = {};
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/outbox', { enqueue: async message => { outboxed.push(message); return 'id'; } });
stub('../lib/tenantSettings', { getTenantSetting: async () => automation, setTenantSetting: async () => {} });
stub('../lib/daqqiAttendees', {
  getDaqqiAttendees: async () => [
    { round_id: 'r-1', subscriber_id: 's-1', attended_lectures: 3 },
    { round_id: 'r-1', subscriber_id: 's-2', attended_lectures: 1 },
    { round_id: 'r-1', subscriber_id: 's-3', attended_lectures: 0, archived: 1 },
  ],
});
stub('../lib/daqqiAttendeeMoney', {
  attachAttendeeMoney: async (_db, _t, rows) => rows.map(row => ({ ...row, amount_paid: row.subscriber_id === 's-2' ? 1000 : 3400, prior_paid: 0, unlinked_applied: 0, agreed_price: null })),
});

const { buildDokkiWeeklyReport, composeDokkiWeeklyReport, sendDueDokkiWeeklyReports, weekKey } = require('../lib/dokkiWeeklyReport');
const { runAbsenceFollowUp } = require('../lib/dokkiAbsenceFollowUp');

const db = {
  query: async sql => {
    const flat = String(sql).replace(/\s+/g, ' ');
    if (/FROM daqqi_rounds r LEFT JOIN courses c/.test(flat)) {
      return [[{ id: 'r-1', code: '3018', start_date: '2026-09-14', status: 'ACTIVE', reception_name: 'donia hassan', price_egp: 3400,
        postponed_weeks_json: '[]', held_weeks_json: '["2026-09-14","2026-09-21"]', course_title: 'العلاج المعرفي' }]];
    }
    if (/FROM daqqi_attendance_events/.test(flat)) {
      // The table's column is marked_at; created_at made the report a 500.
      assert.match(flat, /marked_at >= \?/);
      assert.doesNotMatch(flat, /created_at/);
      return [[{ round_id: 'r-1', came: 1 }]];
    }
    if (/FROM staff WHERE tenant_id = \? AND role = \?/.test(flat)) return [[{ id: 'st-nashwa', name: 'nashwa', phone: '01000000002' }]];
    if (/FROM daqqi_attendees da JOIN daqqi_rounds r/.test(flat)) {
      return [[
        { round_id: 'r-1', subscriber_id: 's-1', attended_lectures: 3, sessions: 3, name: 'منى', phone: '0101', course_title: 'العلاج المعرفي' },
        { round_id: 'r-1', subscriber_id: 's-2', attended_lectures: 1, sessions: 3, name: 'نهى', phone: '0102', course_title: 'العلاج المعرفي' },
      ]];
    }
    return [[]];
  },
};

test('the week of every running round: who came, the weeks nobody answered, what is owed', async () => {
  const report = await buildDokkiWeeklyReport(db, { tenantId: 't', branch: 'DAQQI', today: '2026-10-10' });
  const [row] = report.rounds;
  assert.equal(report.week, '2026-10-05', 'the schedule\'s week: Monday');
  assert.equal(row.lecture, 4);
  assert.equal(row.unconfirmedWeeks, 2, 'four lectures, two answered');
  assert.equal(row.clients, 2, 'an archived client is not counted');
  assert.equal(row.came, 1);
  assert.deepEqual([row.owed, row.owing], [2400, 1]);
  const text = composeDokkiWeeklyReport(report);
  assert.match(text, /روند 3018 — العلاج المعرفي \(donia hassan\): م4 · حضر 1\/2 · 2 أسبوع مش متأكد · متبقي 2,400 ج\.م/);
});

test('sent to the branch managers on Saturday morning, as a staff message, once a week', async () => {
  automation = {};
  outboxed.length = 0;
  assert.equal(await sendDueDokkiWeeklyReports(db, { tenantId: 't', now: new Date('2026-10-09T08:00:00Z') }), 0, 'Friday: nothing');
  await sendDueDokkiWeeklyReports(db, { tenantId: 't', now: new Date('2026-10-10T08:30:00Z') });
  const sent = outboxed.filter(m => m.recipient === '01000000002');
  assert.ok(sent.length >= 1);
  assert.equal(sent[0].payload.category, 'staff_alert');
  assert.match(sent[0].dedupeKey, /^dokki-weekly:t:DAQQI:2026-10-05:st-nashwa$/);
  automation = { weeklyReport: false };
  outboxed.length = 0;
  await sendDueDokkiWeeklyReports(db, { tenantId: 't', now: new Date('2026-10-10T08:30:00Z') });
  assert.equal(outboxed.length, 0, 'switched off');
  assert.equal(weekKey('2026-10-05'), '2026-10-05');
});

test('the absence follow-up is ready and off until the branch switches it on', async () => {
  automation = {};
  outboxed.length = 0;
  assert.equal(await runAbsenceFollowUp(db, { tenantId: 't' }), 0);
  assert.equal(outboxed.length, 0);
  automation = { absenceFollowUp: true };
  assert.equal(await runAbsenceFollowUp(db, { tenantId: 't' }), 1, 'only the client who missed two');
  assert.equal(outboxed[0].recipient, '0102');
  assert.match(outboxed[0].payload.message, /فاتك 2 محاضرات/);
  assert.equal(outboxed[0].dedupeKey, 'absence:t:r-1:s-2:2', 'once per lecture missed');
});
