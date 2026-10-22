'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ROLE_PERMS } = require('../constants/permissions');
const {
  resolveDepartment, defaultPriority, slaHoursFor, computeSlaDue, pickAssignee, CATEGORY_META,
  DEPARTMENT_ROLES, reopenTicketSql,
} = require('../lib/ticketRouting');

test('every category routes to a department that has staff roles behind it', () => {
  // Derived from DEPARTMENT_ROLES rather than a second hand-written list: the
  // point of the check is that a category cannot route somewhere no employee
  // staffs, and a duplicated list only ever drifts from the real one.
  const depts = new Set(Object.keys(DEPARTMENT_ROLES));
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

test('least-loaded assignment is tenant isolated and counts only active tenant tickets', async () => {
  let captured;
  const db = {
    query: async (sql, params) => {
      captured = { sql, params };
      return [[{ id: 'staff-a', name: 'Agent A', role: 'support' }]];
    },
  };
  const assignee = await pickAssignee(db, 'tenant-a', 'support');
  assert.equal(assignee.id, 'staff-a');
  assert.match(captured.sql, /t\.tenant_id=s\.tenant_id/);
  assert.match(captured.sql, /s\.tenant_id=\?/);
  assert.equal(captured.params[0], 'tenant-a');
});

test('nobody on an approved day off is handed a ticket; an hours-long permission still works', async () => {
  let captured;
  const db = { query: async (sql, params) => { captured = { sql, params }; return [[]]; } };
  await pickAssignee(db, 'tenant-a', 'support', { today: '2026-10-21' });
  assert.match(captured.sql, /NOT EXISTS \(SELECT 1 FROM leaves lv[\s\S]*lv\.status='APPROVED'[\s\S]*lv\.start_date<=\? AND lv\.end_date>=\?/);
  assert.deepEqual(captured.params.slice(-5), ['LATE_PERMIT', 'EARLY_LEAVE', 'PERMISSION', '2026-10-21', '2026-10-21']);
});

test('an HR enquiry skips an HR employee who cannot open tickets and falls to the manager', async () => {
  // In turn the HR employee is first; the HR role does not hold manage_inbox,
  // which every ticket screen asks for.
  const db = { query: async () => [[
    { id: 'hr-1', name: 'HR', role: 'hr', permissions_json: null, tenant_id: 't' },
    { id: 'mgr-1', name: 'Manager', role: 'manager', permissions_json: null, tenant_id: 't' },
  ]] };
  assert.deepEqual(await pickAssignee(db, 't', 'hr'), { id: 'mgr-1', name: 'Manager' });
  // One whose grid was given manage_inbox takes it.
  const granted = { query: async () => [[
    { id: 'hr-1', name: 'HR', role: 'hr', permissions_json: JSON.stringify(['manage_inbox', 'view_hr']), tenant_id: 't' },
    { id: 'mgr-1', name: 'Manager', role: 'manager', permissions_json: null, tenant_id: 't' },
  ]] };
  assert.equal((await pickAssignee(granted, 't', 'hr')).id, 'hr-1');
});

test('a reopened ticket is a new wait: resolved and answered cleared, the SLA restarted', () => {
  const sql = reopenTicketSql();
  for (const column of ['resolved_at', 'first_response_at', 'sla_breach_notified_at']) {
    assert.match(sql, new RegExp(`${column}=IF\\(status IN \\('resolved','closed'\\), NULL, ${column}\\)`));
  }
  assert.match(sql, /sla_due_at=IF\(status IN \('resolved','closed'\), NOW\(\) \+ INTERVAL \(CASE LOWER\(priority\) WHEN 'urgent' THEN 2 WHEN 'high' THEN 4/);
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'support.js'), 'utf8');
  // Every place a ticket goes back to open puts it on the clock first.
  const reopens = route.match(/status=IF\(status IN \('resolved','closed'\),'open',status\)/g) || [];
  const clocked = route.match(/\$\{reopenTicketSql\(\)\}, status=IF\(status IN \('resolved','closed'\),'open',status\)/g) || [];
  assert.ok(reopens.length >= 2 && reopens.length === clocked.length);
  assert.match(route, /reopening \? `\$\{reopenTicketSql\('TRUE'\)\}, ` : ''/);
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

test('support queues are department scoped and customer ownership follows canonical subscriber identity', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'support.js'), 'utf8');
  const ui = fs.readFileSync(path.join(__dirname, '..', '..', 'admin', 'pages', 'dashboard', 'tabs', 'CustomerInboxTab.tsx'), 'utf8');
  assert.match(route, /const ticketScope =/);
  assert.match(route, /canAccessTicket\(req,/);
  assert.match(route, /findSubscriberForIdentity\(req\.tenantId, req\.user/);
  assert.match(route, /Staff role is not compatible with the ticket department/);
  // Asserted on the exported matrix rather than on the distance between two
  // strings in its source: a comment added inside a role's list would push the
  // token out of a character window and fail a matrix that is correct.
  for (const role of ['sales', 'collection', 'accountant']) {
    assert.ok(ROLE_PERMS[role].includes('manage_inbox'),
      `${role} can no longer open the support queue`);
  }
  // The SLA is the server's (SLA_HOURS); the page reads the flag it sends.
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'lib', 'ticketRouting.js'), 'utf8'), /urgent: 2, high: 4, medium: 24, low: 72/);
  assert.match(ui, /item\.sla \? item\.sla === 'overdue'/);
  assert.match(ui, /closed_reason: reason/);
});
