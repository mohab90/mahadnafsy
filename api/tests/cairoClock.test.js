'use strict';
// The institute works in Cairo time; the server, the database and the Node
// process all run in UTC. These pin the helpers that bridge the two, including
// the part every zone bug gets wrong: Egypt moves its clocks. Summer is UTC+3
// (from the last Friday of April to the last Thursday of October), winter UTC+2.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  cairoToday, cairoClock, cairoOffsetMinutes, cairoDayStartUtc,
  sqlCairoToday, sqlCairoDayStartUtc,
} = require('../lib/dates');

test('Cairo is two hours ahead in winter and three in summer', () => {
  assert.equal(cairoOffsetMinutes(new Date('2026-01-15T12:00:00Z')), 120);
  assert.equal(cairoOffsetMinutes(new Date('2026-07-01T12:00:00Z')), 180);
  assert.equal(cairoOffsetMinutes(new Date('2026-09-24T12:00:00Z')), 180);
});

test('an employee checking in at nine in Cairo is recorded at nine', () => {
  // 06:00 UTC in September is 09:00 in Cairo. HOUR(NOW()) recorded 06:00, which
  // is before any shift starts, so nobody who arrived before noon was ever late.
  const clock = cairoClock(new Date('2026-09-24T06:00:00Z'));
  assert.deepEqual(clock, { date: '2026-09-24', time: '09:00', minutes: 540 });
});

test('Cairo is already tomorrow while UTC is still today', () => {
  // 22:30 UTC on the 23rd is 01:30 on the 24th in Cairo. CURDATE() said the 23rd,
  // so a check-in, a sale or a distributed lead in that window was filed a day early.
  assert.equal(cairoToday(new Date('2026-09-23T22:30:00Z')), '2026-09-24');
  assert.equal(cairoToday(new Date('2026-09-23T20:30:00Z')), '2026-09-23');
});

test('a Cairo day begins at the right UTC instant in both seasons', () => {
  assert.equal(cairoDayStartUtc('2026-01-15'), '2026-01-14 22:00:00');
  assert.equal(cairoDayStartUtc('2026-07-01'), '2026-06-30 21:00:00');
  assert.equal(cairoDayStartUtc('2026-09-24'), '2026-09-23 21:00:00');
});

test('the inlined SQL is a strict literal and nothing else', () => {
  const now = new Date('2026-09-24T06:00:00Z');
  assert.equal(sqlCairoToday(now), "DATE('2026-09-24')");
  assert.equal(sqlCairoDayStartUtc(now), "'2026-09-23 21:00:00'");
  assert.throws(() => cairoDayStartUtc("2026-09-24' OR 1=1 --"), /not a date/);
});
