'use strict';
/** The pure parts of lib/salesSheetReconcile.js: a tab named for an employee, and the ladder over a rep's rows by round. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { mapTabsToStaff, ladderOver } = require('../lib/salesSheetReconcile');
const { normalizePlan } = require('../lib/bonusPlan');

const seeded = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'migrations', '381_v26_bonus_plan.sql'), 'utf8').match(/'bonus_plan', '(\{.*\})', 0/)[1]);
const person = (name, active = 1) => ({ id: name, name, is_active: active });

test('a tab is mapped to the employee whose name holds all its words; an active one first; two equal fits are ambiguous and mapped to no one', () => {
  const staff = [person('رودينا احمد علي'), person('دنيا وائل محمد'), person('دنيا راشد حسن'), person('سما تجريبية'), person('سماح تجريبية'), person('نورا سالم', 0), person('نورا حسن'), person('هالة كمال'), person('هاله فتحي')];
  const mapped = Object.fromEntries(mapTabsToStaff(['رودينا', 'دنيا وائل', 'دنيا راشد', 'دنيا', 'سما', 'نورا', 'هالة', 'غريبة'], staff).map(item => [item.tab, item.staff?.name || item.ambiguous.join('+') || null]));
  assert.deepEqual(mapped, {
    'رودينا': 'رودينا احمد علي', 'دنيا وائل': 'دنيا وائل محمد', 'دنيا راشد': 'دنيا راشد حسن',
    'دنيا': 'دنيا وائل محمد+دنيا راشد حسن', 'سما': 'سما تجريبية', 'نورا': 'نورا حسن', 'هالة': 'هالة كمال+هاله فتحي', 'غريبة': null,
  });
});

test('the ladder over rows: per half month when the plan says so, each round on the whole ladder from the rep\'s first target', () => {
  const half = normalizePlan({ ...seeded, salesPeriod: 'HALF_MONTH' });
  const month = normalizePlan({ ...seeded, salesPeriod: 'MONTH' });
  const items = [...Array(10).fill({ weight: 1, round: 1 }), ...Array(5).fill({ weight: 1, round: 2 })];
  const roundOf = item => item.round;
  assert.deepEqual(ladderOver(half, items, 10, roundOf).rounds, [{ label: '1–15', bookings: 10, amount: 1000 }, { label: '16–31', bookings: 5, amount: 0 }]);
  assert.deepEqual(ladderOver(half, items, 10, roundOf, { splitDay: 13, lastDay: 30 }).rounds.map(round => round.label), ['1–12', '13–30'], 'the rounds are named for the split');
  assert.equal(ladderOver(half, items, 10, roundOf).amount, 1000);
  assert.equal(ladderOver(month, items, 10, roundOf).amount, 1500, 'the same fifteen bookings in one month');
  assert.equal(ladderOver(half, items, 15, roundOf).amount, 0, 'a first target of 15 in neither round');
});
