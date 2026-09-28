'use strict';

// A cap on what a rep RECEIVES, separate from max_open_leads which caps what
// they hold. A rep who closes quickly never reaches the open cap and could be
// handed an unlimited stream; the owner asked for a limit per day, per
// fortnight, or per month.
//
// Windows are calendar-aligned so "how many more do I get today" has an answer
// that resets at a moment a person can name, and counted in Africa/Cairo so
// "today" is the day the desk is having.

const test = require('node:test');
const assert = require('node:assert');
const { periodStart, hasRoom, PERIODS } = require('../lib/assignmentQuota');
const { cairoDayStartUtc } = require('../lib/dates');
const { createRepRotation } = require('../lib/leadAssignment');

// The window opens at Cairo's midnight on the given day, expressed as the UTC
// instant leads.assigned_at is stored in.
const cairoMidnight = day => cairoDayStartUtc(day);

// 14:00 UTC on the 9th is still the 9th in Cairo; 22:30 UTC is already the 10th.
const at = (iso) => new Date(iso);

test('the window is compared as the UTC instant assigned_at is stored in', () => {
  // assigned_at is written with NOW(), in UTC. Returning Cairo's midnight as a
  // bare '2026-09-27 00:00:00' meant UTC midnight — 03:00 in Cairo — so until
  // then the window started in the future and every rep counted zero. On 27
  // September that let the sheet sync hand Rodina seven leads before 02:36
  // against a cap of five.
  assert.strictEqual(periodStart('day', at('2026-09-26T22:30:00Z')), '2026-09-26 21:00:00', 'summer, +3');
  assert.strictEqual(periodStart('day', at('2026-01-15T14:00:00Z')), '2026-01-14 22:00:00', 'winter, +2');
  // 01:30 in Cairo: the window has already begun, not three hours from now.
  assert.ok(periodStart('day', at('2026-09-26T22:30:00Z')) <= '2026-09-26 22:30:00');
});

test('a batch counts each rep towards their cap as it hands leads out', () => {
  // listDistributableReps drops a rep already at the cap, but one short of it
  // passed that check and then took every lead the rotation reached them with.
  const reps = [
    { id: 'rodina', name: 'Rodina', activeLeads: 0, maxOpenLeads: null, intakeLimit: 5, taken: 4 },
    { id: 'donia', name: 'Donia', activeLeads: 0, maxOpenLeads: null, intakeLimit: 5, taken: 3 },
  ];
  const rotation = createRepRotation(reps, { mode: 'rr' });
  const handed = Array.from({ length: 10 }, () => rotation.next()?.id ?? null);
  assert.deepStrictEqual(handed.filter(id => id === 'rodina').length, 1, 'Rodina had room for one');
  assert.deepStrictEqual(handed.filter(id => id === 'donia').length, 2, 'Donia had room for two');
  assert.deepStrictEqual(handed.slice(3), Array(7).fill(null), 'the rest stay unassigned, for «محلي جديد»');
});

test('the daily window starts at midnight Cairo, not midnight UTC', () => {
  assert.strictEqual(periodStart('day', at('2026-08-09T14:00:00Z')), cairoMidnight('2026-08-09'));
  // 22:30 UTC is 01:30 the next day in Cairo — the desk has rolled over.
  assert.strictEqual(periodStart('day', at('2026-08-09T22:30:00Z')), cairoMidnight('2026-08-10'));
});

test('the fortnight splits the month at the 16th', () => {
  assert.strictEqual(periodStart('fortnight', at('2026-08-01T09:00:00Z')), cairoMidnight('2026-08-01'));
  assert.strictEqual(periodStart('fortnight', at('2026-08-15T09:00:00Z')), cairoMidnight('2026-08-01'));
  assert.strictEqual(periodStart('fortnight', at('2026-08-16T09:00:00Z')), cairoMidnight('2026-08-16'));
  assert.strictEqual(periodStart('fortnight', at('2026-08-31T09:00:00Z')), cairoMidnight('2026-08-16'));
});

test('the fortnight stays aligned to the month rather than drifting', () => {
  // A rolling 15 days would put February and March out of step with each other;
  // both halves here begin on a date the owner can point at.
  for (const month of ['01', '02', '03', '11', '12']) {
    assert.strictEqual(periodStart('fortnight', at(`2026-${month}-07T09:00:00Z`)), cairoMidnight(`2026-${month}-01`));
    assert.strictEqual(periodStart('fortnight', at(`2026-${month}-20T09:00:00Z`)), cairoMidnight(`2026-${month}-16`));
  }
});

test('the monthly window starts on the first', () => {
  assert.strictEqual(periodStart('month', at('2026-08-27T09:00:00Z')), cairoMidnight('2026-08-01'));
  assert.strictEqual(periodStart('month', at('2026-01-01T09:00:00Z')), cairoMidnight('2026-01-01'));
});

test('an unknown period falls back to the day rather than to no limit', () => {
  // Falling back to "no window" would silently switch the cap off.
  assert.strictEqual(periodStart('year', at('2026-08-09T09:00:00Z')), cairoMidnight('2026-08-09'));
  assert.strictEqual(periodStart(undefined, at('2026-08-09T09:00:00Z')), cairoMidnight('2026-08-09'));
});

test('the week starts on Saturday, the first working day here', () => {
  // 8 August 2026 is a Saturday.
  assert.strictEqual(periodStart('week', at('2026-08-08T09:00:00Z')), cairoMidnight('2026-08-08'));
  assert.strictEqual(periodStart('week', at('2026-08-09T09:00:00Z')), cairoMidnight('2026-08-08'));
  assert.strictEqual(periodStart('week', at('2026-08-14T20:00:00Z')), cairoMidnight('2026-08-08'), 'Friday');
  // 21:30 UTC on Friday is already Saturday in Cairo: a new week.
  assert.strictEqual(periodStart('week', at('2026-08-14T21:30:00Z')), cairoMidnight('2026-08-15'));
});

test('no limit set means no rate cap', () => {
  // Every rep starts here, so this is the state that must not block anyone.
  for (const member of [{}, { intake_limit: null }, { intake_limit: 0 }, { intake_limit: -3 }]) {
    assert.strictEqual(hasRoom(member, 9999), true);
  }
});

test('a rep with room takes another; a rep at the limit does not', () => {
  const member = { intake_limit: 20 };
  assert.strictEqual(hasRoom(member, 0), true);
  assert.strictEqual(hasRoom(member, 19), true);
  assert.strictEqual(hasRoom(member, 20), false);
  assert.strictEqual(hasRoom(member, 21), false);
});

test('the periods the owner asked for are the ones offered', () => {
  // «يوميا ولا اسبوعيا ولا 15 يوم ولا في الشهر».
  assert.deepStrictEqual([...PERIODS].sort(), ['day', 'fortnight', 'month', 'week']);
});
