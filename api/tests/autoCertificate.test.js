'use strict';
// A certificate is earned by two things at once: half the course watched and
// 95% of it paid. Either alone would certify the wrong person — someone who
// never finished paying, or someone who never opened a lecture.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, WATCHED_THRESHOLD, PAID_THRESHOLD } = require('../lib/autoCertificate');

const row = (watched, total, paid, price) => ({
  total_lectures: total, watched_lectures: watched, paid_egp: paid, price_egp: price,
});

test('the thresholds are the ones the owner asked for', () => {
  assert.equal(WATCHED_THRESHOLD, 50);
  assert.equal(PAID_THRESHOLD, 0.95);
});

test('half watched and fully paid earns it', () => {
  assert.equal(evaluate(row(5, 10, 4000, 4000)).ok, true);
});

test('exactly on both thresholds earns it', () => {
  const verdict = evaluate(row(5, 10, 3800, 4000)); // 50% watched, 95% paid
  assert.equal(verdict.ok, true);
});

test('watching without paying does not earn it', () => {
  const verdict = evaluate(row(10, 10, 3000, 4000)); // 100% watched, 75% paid
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'not_paid_enough');
});

test('paying without watching does not earn it', () => {
  const verdict = evaluate(row(2, 10, 4000, 4000)); // 20% watched, paid in full
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'not_watched_enough');
});

test('a course with no lectures or no price is never certified automatically', () => {
  assert.equal(evaluate(row(0, 0, 4000, 4000)).reason, 'no_lectures');
  assert.equal(evaluate(row(5, 10, 0, 0)).reason, 'no_price');
});

test('overpaying does not break the comparison', () => {
  assert.equal(evaluate(row(9, 10, 5000, 4000)).ok, true);
});
