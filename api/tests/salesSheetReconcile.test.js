'use strict';
/** The pure parts of lib/salesSheetReconcile.js: a tab named for an employee, and the ladder over a rep's rows by round. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { mapTabsToStaff, ladderOver } = require('../lib/salesSheetReconcile');
const { normalizePlan } = require('../lib/bonusPlan');
const { listAdjustments } = require('../lib/bonusAdjustments');

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

test('an explicit map comes first: tab → staff id or exact name (spaces collapsed, case ignored), for staff named in another script; a map entry that matches no one is said', () => {
  const staff = [{ id: 'st-1', name: 'Rodina  Tharwat', is_active: 1 }, { id: 'st-2', name: 'Sama Shosha', is_active: 1 }, { id: 'st-3', name: 'دنيا وائل محمد', is_active: 1 }, { id: 'st-4', name: 'Doaa Awny', is_active: 1 }];
  const tabs = ['رودينا', 'سما', 'دنيا وائل', ' دعاء   عونى ', 'غريبة'];
  const bare = mapTabsToStaff(tabs, staff);
  assert.deepEqual(bare.map(item => item.staff?.id || null), [null, null, 'st-3', null, null], 'by name alone, only the Arabic-named employee is found');
  const mapped = mapTabsToStaff(tabs, staff, { 'رودينا': 'st-1', ' سما ': 'sama   SHOSHA', 'دعاء عونى': 'Doaa Awny', 'غريبة': 'No One' });
  assert.deepEqual(mapped.map(item => [item.staff?.id || null, item.via]), [['st-1', 'map'], ['st-2', 'map'], ['st-3', 'name'], ['st-4', 'map'], [null, null]]);
  assert.match(mapped[4].mapError, /ما طابقش أي موظف/);
  assert.equal(mapTabsToStaff(['سما'], staff, { 'سما': 'st-3' })[0].staff.id, 'st-3', 'the map wins over the name');
  assert.equal(mapTabsToStaff(['سما'], staff, ['not', 'an', 'object'])[0].staff, null, 'a map that is not an object is ignored');
});

test('the adjustments of a month on a database without migration 383 are none, not a crash; any other error is not swallowed', async () => {
  const missing = { query: async () => { throw Object.assign(new Error("Table 'x.bonus_adjustments' doesn't exist"), { code: 'ER_NO_SUCH_TABLE', errno: 1146 }); } };
  assert.deepEqual(await listAdjustments(missing, { tenantId: 't', year: 2026, month: 10 }), []);
  const broken = { query: async () => { throw Object.assign(new Error('connection lost'), { code: 'PROTOCOL_CONNECTION_LOST' }); } };
  await assert.rejects(() => listAdjustments(broken, { tenantId: 't', year: 2026, month: 10 }), /connection lost/);
});
