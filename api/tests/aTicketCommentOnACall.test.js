'use strict';

// 25 Oct 2026 — «لما خدمة العملاء بتفتح تيكت وتكتب تعليق على اتصال بيطلع error».
//
// Root cause: seven routes read the ticket with a hand-written column list and then asked canAccessTicket()
// whether the employee may touch it. That check also needs `category` and `escalated_at` (a ticket the SLA sweep or
// a colleague escalated to the administration stays in its department's queue by them), but the lists omitted them,
// so for an escalated ticket — which the list and the detail (SELECT *) do show — logging the call, replying,
// changing the status, routing, assigning or prioritising all answered «Not found».

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-ticket-comment-secret-0123456789-abcdefghijklmnop';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../routes/support.js'), 'utf8');

test('every route that guards a ticket with canAccessTicket reads the columns the guard needs', () => {
  // Each `... FROM support_tickets WHERE id=? ...` read that is followed (within the route) by canAccessTicket.
  const reads = [...source.matchAll(/SELECT ([^`'"]*?) FROM support_tickets WHERE id=\? AND tenant_id=\?[^`'"]*FOR UPDATE/g)];
  const guarded = reads.filter(match => {
    const after = source.slice(match.index, match.index + 900);
    const next = after.search(/router\.(get|post|put|patch|delete)\(/);
    return /canAccessTicket\(/.test(next === -1 ? after : after.slice(0, next));
  });
  assert.ok(guarded.length >= 7, `found ${guarded.length} guarded reads`);
  for (const read of guarded) {
    const columns = read[1].split(',').map(column => column.trim());
    for (const needed of ['department', 'assigned_to', 'category', 'escalated_at']) {
      assert.ok(columns.includes(needed), `${needed} missing from: SELECT ${read[1]}`);
    }
  }
});

test('customer service may act on a ticket escalated in its category — and not on one in another department', () => {
  const support = require('../routes/support');
  const service = { staffRecord: { id: 's1', role: 'support' } };
  const escalated = { department: 'management', assigned_to: 'm1', category: 'technical', escalated_at: '2026-10-20' };
  assert.equal(support.canAccessTicket(service, escalated), true);
  // The row as the routes used to read it: the check cannot see that it was escalated.
  assert.equal(support.canAccessTicket(service, { department: 'management', assigned_to: 'm1' }), false);
  assert.equal(support.canAccessTicket(service, { department: 'accounting', assigned_to: 'a1', category: 'refund', escalated_at: null }), false);
});

test('an e-mail that was sent is a contact that was reached, here as on the server', () => {
  const tab = fs.readFileSync(path.join(__dirname, '../../admin/pages/dashboard/tabs/TicketContact.tsx'), 'utf8');
  assert.match(tab, /const reached = outcome === 'answered' \|\| outcome === 'sent';/);
  assert.match(source, /const reached = outcome === 'answered' \|\| outcome === 'read' \|\| outcome === 'sent';/);
});
