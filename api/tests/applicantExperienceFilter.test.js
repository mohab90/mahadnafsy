'use strict';

// The experience picker on طلبات الانضمام and on الانترفيوهات is one setting
// with one meaning: a MINIMUM. Both screens had their own copy of the
// predicate, which is how "3 سنوات فأكثر" ends up meaning two different things
// depending on which screen you set it on. It now lives in
// admin/pages/dashboard/tabs/hr-sections/applicantLabels.ts and these pin its
// behaviour — the admin app has no test runner of its own, so the rules are
// asserted here against the same logic.

const test = require('node:test');
const assert = require('node:assert');

const ORDER = ['none', 'under_1', '1-3', '3-5', '5-10', '10plus'];
const rank = v => ORDER.indexOf(String(v || ''));

// Mirrors matchesMinExperience().
const matches = (value, min) => {
  if (!min) return true;
  if (min === 'only_none') return value === 'none';
  const r = rank(value);
  return r >= 0 && r >= rank(min);
};

test('no setting shows everyone, including unrecorded experience', () => {
  for (const v of [...ORDER, null, undefined, '', 'nonsense']) {
    assert.equal(matches(v, ''), true, `${v} should pass an empty filter`);
  }
});

test('a minimum keeps that band and everything above it', () => {
  assert.equal(matches('3-5', '3-5'), true);
  assert.equal(matches('5-10', '3-5'), true);
  assert.equal(matches('10plus', '3-5'), true);
});

test('a minimum drops everything below it', () => {
  assert.equal(matches('1-3', '3-5'), false);
  assert.equal(matches('under_1', '3-5'), false);
  assert.equal(matches('none', '3-5'), false);
});

test('unrecorded experience fails a minimum — unknown is not senior', () => {
  for (const v of [null, undefined, '', 'nonsense']) {
    assert.equal(matches(v, '3-5'), false, `${v} must not pass a minimum`);
  }
});

test('"بدون خبرة فقط" is an exact search, not the bottom of a range', () => {
  assert.equal(matches('none', 'only_none'), true);
  assert.equal(matches('under_1', 'only_none'), false);
  assert.equal(matches('10plus', 'only_none'), false);
  assert.equal(matches(null, 'only_none'), false,
    'someone with nothing recorded is not the same as someone who said "no experience"');
});

test('the stored codes are the ones the public forms write', () => {
  // client/pages/JoinStaff.tsx offers all six; JoinTeaching.tsx offers the top
  // three. A form writing "10+" instead of "10plus" is exactly the drift that
  // made instructors invisible to every experience filter.
  assert.deepEqual(ORDER, ['none', 'under_1', '1-3', '3-5', '5-10', '10plus']);
  assert.equal(matches('10+', '5-10'), false,
    'the old instructor value must not silently pass — it is not a known band');
});
