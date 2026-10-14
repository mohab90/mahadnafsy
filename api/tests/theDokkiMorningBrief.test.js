'use strict';

// «بيبعت اشعار كل يوم لمدير الفرع ومسئول الروند عن الروند ياكد علي المحاضرة
// ويبعتله العملاء اللى عليها فلوس متاخره» (10 Oct 2026).

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
    { round_id: 'r-sat', subscriber_id: 's-1', name: 'منى', phone: '0101' },
    { round_id: 'r-sat', subscriber_id: 's-2', name: 'نهى', phone: '0102' },
    { round_id: 'r-sat', subscriber_id: 's-3', name: 'مؤرشفة', phone: '0103', archived: 1 },
  ],
});
stub('../lib/daqqiAttendeeMoney', {
  attachAttendeeMoney: async (_db, _t, rows) => rows.map(row => ({ ...row, amount_paid: row.subscriber_id === 's-2' ? 1000 : 3400, prior_paid: 0, unlinked_applied: 0, agreed_price: null })),
});

const { buildDokkiDailyBrief, composeDokkiDailyBrief, meetsToday, sendDueDokkiDailyBriefs } = require('../lib/dokkiDailyBrief');

const db = {
  query: async (sql, params) => {
    const flat = String(sql).replace(/\s+/g, ' ');
    if (/FROM daqqi_rounds r LEFT JOIN courses c/.test(flat)) {
      if (params[1] !== 'DAQQI') return [[]];
      return [[
        // Started Saturday 12 Sep: meets every Saturday — 10 Oct is lecture 5.
        { id: 'r-sat', code: '3018', start_date: '2026-09-12', time_slot: 'EVENING', room: 'قاعة 2', reception_id: 'st-donia', reception_name: 'donia',
          instructor_name: 'أحمد', postponed_weeks_json: '[]', held_weeks_json: '["2026-09-07","2026-09-14","2026-09-21"]', price_egp: 3400, course_title: 'العلاج المعرفي' },
        // A Monday round: not today.
        { id: 'r-mon', code: '3020', start_date: '2026-09-14', time_slot: 'MORNING', reception_id: 'st-other', reception_name: 'x', postponed_weeks_json: '[]', held_weeks_json: '[]', price_egp: 3000 },
      ]];
    }
    if (/FROM staff/.test(flat)) {
      return [[
        { id: 'st-nashwa', name: 'nashwa', phone: '01000000002', role: 'DAQQI_MANAGER' },
        { id: 'st-donia', name: 'donia', phone: '01000000003', role: 'RECEPTION_DAQQI' },
      ]];
    }
    return [[]];
  },
};

test('a round meets on its weekday, from its start', () => {
  assert.equal(meetsToday('2026-09-12', '2026-10-10'), true);
  assert.equal(meetsToday('2026-09-14', '2026-10-10'), false);
  assert.equal(meetsToday('2026-10-17', '2026-10-10'), false, 'not before it starts');
});

test('today\'s rounds: the lecture, a reminder to confirm it, and who still owes', async () => {
  const brief = await buildDokkiDailyBrief(db, { tenantId: 't', branch: 'DAQQI', today: '2026-10-10' });
  assert.deepEqual(brief.rounds.map(round => round.code), ['3018']);
  const [round] = brief.rounds;
  assert.equal(round.lecture, 5);
  assert.equal(round.clients, 2, 'an archived client is not counted');
  assert.deepEqual(round.owing, [{ name: 'نهى', phone: '0102', left: 2400 }]);
  assert.equal(round.unconfirmedBefore, 1, 'four weeks before this one, three confirmed');
  const text = composeDokkiDailyBrief(brief);
  assert.match(text, /روند 3018\* — العلاج المعرفي/);
  assert.match(text, /النهارده المحاضرة 5 · مسائي · قاعة 2/);
  assert.match(text, /أكّدها من جدول الفرع: «اشتغلت» أو «اتأجلت»/);
  assert.match(text, /• نهى 0102 — باقي 2,400/);
});

test('sent from 9 a.m. to the manager and to the round\'s reception, once a day, and can be switched off', async () => {
  automation = {};
  outboxed.length = 0;
  assert.equal(await sendDueDokkiDailyBriefs(db, { tenantId: 't', now: new Date('2026-10-10T05:30:00Z') }), 0, '08:30 Cairo: not yet');
  await sendDueDokkiDailyBriefs(db, { tenantId: 't', now: new Date('2026-10-10T07:05:00Z') });
  assert.deepEqual(outboxed.map(m => m.recipient).sort(), ['01000000002', '01000000003']);
  assert.ok(outboxed.every(m => m.payload.category === 'staff_alert'));
  assert.match(outboxed[0].dedupeKey, /^dokki-daily:t:DAQQI:2026-10-10:st-/);
  automation = { dailyBrief: false };
  outboxed.length = 0;
  await sendDueDokkiDailyBriefs(db, { tenantId: 't', now: new Date('2026-10-10T07:05:00Z') });
  assert.equal(outboxed.length, 0, 'switched off');
});
