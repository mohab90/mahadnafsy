'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
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

test('support ticket details, replies and linked finance records are tenant scoped', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'support.js'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '084_v25_support_reply_tenant_scope.sql'), 'utf8');
  assert.match(migration, /ALTER TABLE ticket_replies[\s\S]*tenant_id/);
  assert.match(route, /support_tickets WHERE id=\? AND tenant_id=\?/);
  assert.match(route, /ticket_replies WHERE ticket_id=\? AND tenant_id=\?/);
  assert.match(route, /payments WHERE id=\? AND tenant_id=\?/);
  assert.match(route, /subscribers WHERE id=\? AND tenant_id=\?/);
});

test('staff and client replies persist timeline and outbox atomically', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'support.js'), 'utf8');
  assert.match(route, /INSERT INTO ticket_replies \(id, tenant_id/);
  assert.match(route, /outbox\.enqueue\([\s\S]*ticket-reply:/);
  assert.match(route, /await conn\.beginTransaction\(\)[\s\S]*logTicketEvent\(conn[\s\S]*await conn\.commit\(\)/);
  assert.match(route, /contact_messages WHERE id=\? AND tenant_id=\?[^\n]+FOR UPDATE/);
  assert.match(route, /UPDATE contact_messages SET[^\n]+WHERE id=\? AND tenant_id=\?/);
});
