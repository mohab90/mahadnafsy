'use strict';
/**
 * Unit tests for lead-score business logic (status + interest + comms + decay).
 * Pure function, no DB. Run: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calcLeadScoreServer } = require('../lib/helpers');

test('converted lead scores at the cap (100)', () => {
  assert.equal(calcLeadScoreServer('converted', 'high', [], null, []), 100);
});

test('terminal negative statuses floor near 0', () => {
  assert.equal(calcLeadScoreServer('lost', 'low', [], null, []), 5);          // 0 + low(5)
  assert.equal(calcLeadScoreServer('not_interested', 'low', [], null, []), 5);
  assert.equal(calcLeadScoreServer('wrong_number', 'low', [], null, []), 5);
});

test('interest level adds the right weight', () => {
  const base = calcLeadScoreServer('new', 'low', [], null, []);     // 5 + 5
  const med  = calcLeadScoreServer('new', 'medium', [], null, []);  // 5 + 15
  const high = calcLeadScoreServer('new', 'high', [], null, []);    // 5 + 30
  assert.equal(base, 10);
  assert.equal(med, 20);
  assert.equal(high, 35);
});

test('communications add 5 each, capped at 25', () => {
  const comms = (n) => Array.from({ length: n }, () => ({}));
  assert.equal(calcLeadScoreServer('new', 'low', comms(2), null, []), 10 + 10);
  assert.equal(calcLeadScoreServer('new', 'low', comms(10), null, []), 10 + 25); // capped
});

test('follow-up date + interested courses add bonuses', () => {
  const withFollow = calcLeadScoreServer('new', 'low', [], '2026-07-01', []);  // +5
  const withCourse = calcLeadScoreServer('new', 'low', [], null, ['c1']);      // +10
  assert.equal(withFollow, 15);
  assert.equal(withCourse, 20);
});

test('stale lead decays (no contact for a long time)', () => {
  const old = new Date(Date.now() - 60 * 86400000).toISOString(); // 60 days ago
  const fresh = calcLeadScoreServer('interested', 'high', [{ date: new Date().toISOString() }], null, []);
  const stale = calcLeadScoreServer('interested', 'high', [{ date: old }], null, []);
  assert.ok(stale < fresh, 'stale contact should score lower than fresh');
});

test('score is always clamped to [0,100]', () => {
  const r = calcLeadScoreServer('converted', 'high', Array.from({ length: 20 }, () => ({})), '2026-07-01', ['a', 'b']);
  assert.ok(r >= 0 && r <= 100);
});
