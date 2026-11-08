'use strict';
/**
 * «نظام المكافآت» (lib/bonusPlan.js) with the plan migration 381 seeds — the owner's numbers of 8 Nov 2026 — read from the migration itself, so the test
 * holds the rules to the data the institute starts with.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { normalizePlan, bookingWeight, ladderBonus, normalizeLevels, collectionBonus, courseBonusAmount } = require('../lib/bonusPlan');

const seeded = fs.readFileSync(path.join(__dirname, '..', 'migrations', '381_v26_bonus_plan.sql'), 'utf8').match(/'bonus_plan', '(\{.*\})', 0/)[1];
const PLAN = normalizePlan(JSON.parse(seeded));

test('a course counts as bookings by its price: under 4,400 one, from 4,400 one and a half … over 20,000 five', () => {
  const cases = [
    [3000, 1], [4399, 1], [4400, 1.5], [6799, 1.5], [6800, 2], [8899, 2], [8900, 2.5], [11000, 2.5], [11001, 3],
    [13000, 3], [13001, 3.5], [15000, 3.5], [15001, 4], [20000, 4], [20001, 5], [45000, 5],
  ];
  for (const [price, weight] of cases) assert.equal(bookingWeight(PLAN, price), weight, `${price} EGP`);
});

test('the ladder: 10 → 1,000, 15 → 1,500, 20 → 2,500, 25 → 3,300, 30 → 4,200; 140 a booking from 20 to 30, 200 past 30', () => {
  const cases = [[9.5, 0], [10, 1000], [12, 1000], [14.5, 1000], [15, 1500], [19, 1500], [20, 2500], [21, 2640], [23, 2920], [24.5, 3130],
    [25, 3300], [27, 3580], [30, 4200], [31, 4400], [35, 5200]];
  for (const [bookings, amount] of cases) assert.equal(ladderBonus(PLAN, bookings).amount, amount, `${bookings} bookings`);
});

test('a rep\'s first target is where their ladder starts: 15 earns nothing at 12, 20 nothing at 18', () => {
  assert.equal(ladderBonus(PLAN, 12, 10).amount, 1000);
  assert.equal(ladderBonus(PLAN, 12, 15).amount, 0);
  assert.equal(ladderBonus(PLAN, 16, 15).amount, 1500);
  assert.equal(ladderBonus(PLAN, 18, 20).amount, 0);
  assert.deepEqual([ladderBonus(PLAN, 22, 20).amount, ladderBonus(PLAN, 22, 20).tier.bookings], [2780, 20]);
});

test('a collector\'s level applies to the whole month; percent or a fixed amount; below the first level nothing', () => {
  const levels = normalizeLevels(JSON.stringify([{ from: 80000, kind: 'percent', value: 3 }, { from: 50000, kind: 'percent', value: 2 }, { from: 120000, kind: 'fixed', value: 5000 }]));
  assert.deepEqual(levels.map(level => level.from), [50000, 80000, 120000]);
  assert.equal(collectionBonus(levels, 40000).amount, 0);
  assert.equal(collectionBonus(levels, 50000).amount, 1000);
  assert.equal(collectionBonus(levels, 90000).amount, 2700);
  assert.equal(collectionBonus(levels, 150000).amount, 5000);
});

test('a course\'s own desk bonus: a fixed amount, or a percentage of the booking\'s price in EGP', () => {
  assert.equal(courseBonusAmount({ type: 'fixed', value: 150 }, 9000), 150);
  assert.equal(courseBonusAmount({ type: 'percent', value: 2 }, 9000), 180);
  assert.equal(courseBonusAmount(null, 9000), 0);
});

test('the plan is checked: a band with no price, a ladder repeating a tier, a level over 100% are refused with a sentence', () => {
  assert.throws(() => normalizePlan({ bookingWeights: [{ min: '', weight: 2 }] }), /شريحة سعر/);
  assert.throws(() => normalizePlan({ bookingLadder: [{ bookings: 10, amount: 1 }, { bookings: 10, amount: 2 }] }), /متكرر/);
  assert.throws(() => normalizeLevels([{ from: 0, kind: 'percent', value: 120 }]), /ليفل/);
  assert.equal(PLAN.courseSalesBonusEnabled, false, 'the course page\'s sales bonus stays, switched off');
  assert.deepEqual(normalizePlan(null).bookingLadder, [], 'no plan pays nothing');
});
