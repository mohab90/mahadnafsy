'use strict';
/**
 * Three small rules that were regular expressions over the source, now run: a quiz with no passing score does not pass an attempt that answered nothing
 * (lib/quizGrading.js); a consultation cannot be booked for a day that has gone — Cairo's day, not UTC's — nor too far ahead, nor on the wrong weekday, nor too soon
 * (lib/consultationRequests.js bookingRuleError); and a discount with an expiry date runs through its whole Cairo day (lib/effectivePrice.js automaticDiscounts).
 * The instants are in January, when Cairo is two hours ahead of UTC, so 22:30 UTC is already the next day there.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { gradeQuizAttempt } = require('../lib/quizGrading');
const { bookingRuleError, consultationSettings } = require('../lib/consultationRequests');
const { automaticDiscounts } = require('../lib/effectivePrice');

test('a quiz with no passing score does not pass an empty attempt, and keeps the floor it asks for', () => {
  const questions = [{ correctIndex: 0 }, { correctIndex: 1 }, { correctIndex: 2 }];
  for (const passing of [0, undefined, null, '']) {
    const empty = gradeQuizAttempt(questions, [], passing);
    assert.deepEqual([empty.passed, empty.answeredCount, empty.score], [false, 0, 0], `passing score ${JSON.stringify(passing)}: nothing answered is not a pass`);
    assert.equal(gradeQuizAttempt(questions, [-1, -1, -1], passing).passed, false, 'skipped questions are not answers');
  }
  assert.equal(gradeQuizAttempt(questions, [2, 2, 0], 0).passed, true, 'an attempt that answered, however wrong, meets a floor of zero');
  assert.equal(gradeQuizAttempt(questions, [0, 0, 0], 60).passed, false, 'the floor the quiz asks for still applies');
  assert.equal(gradeQuizAttempt(questions, [0, 1, 0], 60).passed, true);
  assert.equal(gradeQuizAttempt([], [], 0).passed, true, 'a quiz with no questions has nothing to attempt');
});

test('a consultation is booked for today or later on Cairo\'s calendar, inside the window, on the slot\'s weekday and with the notice asked for', () => {
  const settings = consultationSettings({ 'consultation.booking_window_days': '10', 'consultation.min_notice_hours': '24' });
  const justAfterCairoMidnight = new Date('2027-01-15T22:30:00Z'); // 16 Jan 00:30 in Cairo
  const code = (sessionDate, slot) => bookingRuleError({ sessionDate, slot, settings: consultationSettings({ 'consultation.booking_window_days': '10' }), now: justAfterCairoMidnight })?.code ?? null;
  assert.equal(code(''), null, 'no date: nothing to check');
  assert.equal(code('not-a-date'), 'SESSION_DATE_INVALID');
  assert.equal(code('2027-01-15'), 'SESSION_DATE_PAST', 'yesterday in Cairo, though UTC is still on the 15th');
  assert.equal(code('2027-01-16'), null, 'today in Cairo');
  assert.equal(code('2027-01-26'), null, 'the last day of the window');
  assert.equal(code('2027-01-27'), 'SESSION_DATE_TOO_FAR');
  assert.equal(code('2027-01-18', { day: 'monday', start_time: '10:00:00' }), null, '18 Jan 2027 is a Monday');
  assert.equal(code('2027-01-19', { day: 'monday', start_time: '10:00:00' }), 'SLOT_DAY_MISMATCH');
  const soon = bookingRuleError({ sessionDate: '2027-01-16', slot: { day: 'saturday', start_time: '09:00:00' }, settings, now: justAfterCairoMidnight });
  assert.equal(soon.code, 'SESSION_TOO_SOON', 'nine in the morning today is less than a day away');
  assert.equal(bookingRuleError({ sessionDate: '2027-01-18', slot: { day: 'monday', start_time: '10:00:00' }, settings, now: justAfterCairoMidnight }), null);
});

test('a discount with an expiry date runs through its Cairo day and stops at the next one', () => {
  const discounts = [{ type: 'course', targetId: 'c1', discountPercent: 20, active: true, expiresAt: '2027-01-15' }];
  const price = now => automaticDiscounts({ type: 'course', itemId: 'c1', currency: 'EGP', base: 1000, discounts, now: new Date(now).getTime() });
  assert.equal(price('2027-01-15T10:00:00Z').length, 1, 'the day of expiry, in the morning');
  assert.equal(price('2027-01-15T21:30:00Z').length, 1, 'still the 15th in Cairo at 23:30');
  assert.equal(price('2027-01-15T22:30:00Z').length, 0, 'the 16th in Cairo: gone');
  assert.equal(price('2027-01-10T12:00:00Z')[0].price, 800, 'before it, 20% off');
});
