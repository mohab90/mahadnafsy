'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  resolveDepartment, defaultPriority, slaHoursFor, computeSlaDue, CATEGORY_META,
} = require('../lib/ticketRouting');

test('every category routes to a known department', () => {
  const depts = new Set(['support','collection','accounting','sales','instruction','management','daqqi']);
  for (const cat of Object.keys(CATEGORY_META)) {
    assert.ok(depts.has(resolveDepartment(cat)), `${cat} -> ${resolveDepartment(cat)}`);
  }
});

test('billing->collection, refund->accounting, complaint->management', () => {
  assert.equal(resolveDepartment('billing'), 'collection');
  assert.equal(resolveDepartment('refund'), 'accounting');
  assert.equal(resolveDepartment('complaint'), 'management');
});

test('unknown category falls back to general/support', () => {
  assert.equal(resolveDepartment('nonsense'), 'support');
  assert.equal(defaultPriority('nonsense'), 'medium');
});

test('SLA hours shrink with priority', () => {
  assert.ok(slaHoursFor('urgent') < slaHoursFor('high'));
  assert.ok(slaHoursFor('high') < slaHoursFor('medium'));
  assert.ok(slaHoursFor('medium') < slaHoursFor('low'));
});

test('computeSlaDue adds the right window', () => {
  const from = new Date('2026-07-02T00:00:00Z');
  const due = computeSlaDue('high', from); // 4h
  assert.equal(due.getTime() - from.getTime(), 4 * 3600 * 1000);
});
