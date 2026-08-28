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

// 14:00 UTC on the 9th is still the 9th in Cairo; 22:30 UTC is already the 10th.
const at = (iso) => new Date(iso);

test('the daily window starts at midnight Cairo, not midnight UTC', () => {
  assert.strictEqual(periodStart('day', at('2026-08-09T14:00:00Z')), '2026-08-09 00:00:00');
  // 22:30 UTC is 01:30 the next day in Cairo — the desk has rolled over.
  assert.strictEqual(periodStart('day', at('2026-08-09T22:30:00Z')), '2026-08-10 00:00:00');
});

test('the fortnight splits the month at the 16th', () => {
  assert.strictEqual(periodStart('fortnight', at('2026-08-01T09:00:00Z')), '2026-08-01 00:00:00');
  assert.strictEqual(periodStart('fortnight', at('2026-08-15T09:00:00Z')), '2026-08-01 00:00:00');
  assert.strictEqual(periodStart('fortnight', at('2026-08-16T09:00:00Z')), '2026-08-16 00:00:00');
  assert.strictEqual(periodStart('fortnight', at('2026-08-31T09:00:00Z')), '2026-08-16 00:00:00');
});

test('the fortnight stays aligned to the month rather than drifting', () => {
  // A rolling 15 days would put February and March out of step with each other;
  // both halves here begin on a date the owner can point at.
  for (const month of ['01', '02', '03', '11', '12']) {
    assert.strictEqual(periodStart('fortnight', at(`2026-${month}-07T09:00:00Z`)), `2026-${month}-01 00:00:00`);
    assert.strictEqual(periodStart('fortnight', at(`2026-${month}-20T09:00:00Z`)), `2026-${month}-16 00:00:00`);
  }
});

test('the monthly window starts on the first', () => {
  assert.strictEqual(periodStart('month', at('2026-08-27T09:00:00Z')), '2026-08-01 00:00:00');
  assert.strictEqual(periodStart('month', at('2026-01-01T09:00:00Z')), '2026-01-01 00:00:00');
});

test('an unknown period falls back to the day rather than to no limit', () => {
  // Falling back to "no window" would silently switch the cap off.
  assert.strictEqual(periodStart('week', at('2026-08-09T09:00:00Z')), '2026-08-09 00:00:00');
  assert.strictEqual(periodStart(undefined, at('2026-08-09T09:00:00Z')), '2026-08-09 00:00:00');
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

test('the three periods the owner asked for are the ones offered', () => {
  assert.deepStrictEqual([...PERIODS].sort(), ['day', 'fortnight', 'month']);
});
