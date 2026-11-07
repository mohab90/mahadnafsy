'use strict';
/** The judging rules of api/lib/anomalies.js on hand figures: a figure against its own four-week baseline. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { judgeDrop, judgeSurge, judgeIdle, inWorkingHours } = require('../lib/anomalies');

test('collections: half the baseline or worse is a drop, a quiet baseline is not judged', () => {
  assert.deepEqual(judgeDrop(400, [2000, 2400, 1600, 2000]), { value: 400, baseline: 2000 });
  assert.deepEqual(judgeDrop(1000, [2000, 2000, 2000, 2000]), { value: 1000, baseline: 2000 }, 'exactly half counts');
  assert.equal(judgeDrop(1001, [2000, 2000, 2000, 2000]), null);
  assert.equal(judgeDrop(0, [300, 200, 100, 0]), null, 'a baseline of 150 is not a business day worth a flag');
  assert.equal(judgeDrop(0, []), null);
});

test('a lead surge needs twice the baseline and at least twenty leads', () => {
  assert.deepEqual(judgeSurge(45, [10, 12, 8, 10]), { value: 45, baseline: 10 });
  assert.equal(judgeSurge(15, [5, 5, 5, 5]), null, 'three times the usual but only fifteen leads');
  assert.equal(judgeSurge(30, [25, 20, 30, 25]), null, 'above the usual, not twice it');
  assert.deepEqual(judgeSurge(20, [0, 0, 0, 0]), { value: 20, baseline: 0 }, 'a new source that brings twenty at once');
});

test('idle: seen in the last quarter hour, no action for an hour, and normally busy', () => {
  const MIN = 60 * 1000;
  assert.deepEqual(judgeIdle({ perDay: 20, lastSeenAgoMs: 5 * MIN, lastActionAgoMs: 90 * MIN }), { perDay: 20, idleMinutes: 90 });
  assert.deepEqual(judgeIdle({ perDay: 20, lastSeenAgoMs: 5 * MIN, lastActionAgoMs: null }), { perDay: 20, idleMinutes: null }, 'in, and nothing all day');
  assert.equal(judgeIdle({ perDay: 20, lastSeenAgoMs: 5 * MIN, lastActionAgoMs: 10 * MIN }), null, 'acted ten minutes ago');
  assert.equal(judgeIdle({ perDay: 3, lastSeenAgoMs: 5 * MIN, lastActionAgoMs: 120 * MIN }), null, 'never a busy account');
  assert.equal(judgeIdle({ perDay: 20, lastSeenAgoMs: 30 * MIN, lastActionAgoMs: 120 * MIN }), null, 'not in the system now');
  assert.equal(judgeIdle({ perDay: 20, lastSeenAgoMs: null, lastActionAgoMs: 120 * MIN }), null);
});

test('working hours: Cairo 09:00–18:00, every day but Friday', () => {
  assert.equal(inWorkingHours(Date.parse('2026-03-12T09:00:00Z')), true, 'Thursday 11:00 in Cairo (UTC+2)');
  assert.equal(inWorkingHours(Date.parse('2026-03-12T05:00:00Z')), false, 'Thursday 07:00');
  assert.equal(inWorkingHours(Date.parse('2026-03-12T16:00:00Z')), false, 'Thursday 18:00 sharp is after hours');
  assert.equal(inWorkingHours(Date.parse('2026-03-13T09:00:00Z')), false, 'Friday');
  assert.equal(inWorkingHours(Date.parse('2026-03-14T09:00:00Z')), true, 'Saturday is a work day');
});
