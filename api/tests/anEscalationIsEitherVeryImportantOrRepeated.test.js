'use strict';
/**
 * «محتاجين يكون عند الادارة 2 اشعار واحد للحاجات المهمة جدا وواحد للحاجات المكررة ويبقى في فرق
 * بينهم» (14 Oct 2026).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { KINDS, repeatsOf, kindOf, notificationFor } = require('../lib/ticketEscalation');
const { visibleBroadcastTypes } = require('../lib/notificationAudience');
const read = file => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');

const dbWith = ({ others = [], reopened = 0 } = {}) => ({
  async query(sql) {
    if (/FROM support_tickets/.test(sql)) return [others];
    if (/FROM ticket_events/.test(sql)) return [[{ n: reopened }]];
    return [[]];
  },
});
const ticket = { id: 'tk-9', category: 'client_problem', subscriber_id: 's-1', subscriber_email: 'a@b.c', subscriber_name: 'منى', subject: 'المحاضر' };

test('a problem that came back is a «متكررة» escalation, a first one is «مهم جدا»', async () => {
  const fresh = await repeatsOf(dbWith(), 't', ticket);
  assert.equal(fresh.count, 0);
  assert.equal(kindOf('', fresh), 'critical');
  const again = await repeatsOf(dbWith({ others: [{ subject: 'الفيديو' }, { subject: 'الصوت' }] }), 't', ticket);
  assert.equal(again.count, 2);
  assert.equal(kindOf('', again), 'repeated');
  const reopened = await repeatsOf(dbWith({ reopened: 1 }), 't', ticket);
  assert.equal(reopened.count, 1, 'a ticket closed once and reopened is a repeat');
  assert.equal(kindOf('critical', again), 'critical', 'what the team chose stands');
});

test('the two kinds are different notifications with different titles and priorities', () => {
  const repeats = { count: 2, previous: ['الفيديو', 'الصوت'], reopened: false };
  const critical = notificationFor('critical', { ticket, repeats: { count: 0, previous: [] }, reason: 'خطر انسحاب', by: 'هنا' });
  const repeated = notificationFor('repeated', { ticket, repeats, reason: 'رجعت تانى', by: 'هنا' });
  assert.equal(critical.type, 'escalation_critical');
  assert.equal(repeated.type, 'escalation_repeated');
  assert.notEqual(critical.title, repeated.title);
  assert.match(critical.title, /🚨 مهم جدا/);
  assert.match(repeated.title, /🔁 مشكلة متكررة — منى \(رجعت 2 مرات\)/);
  assert.match(repeated.message, /سبق: الفيديو \| الصوت/);
  assert.equal(KINDS.critical.priority, 'urgent');
  assert.equal(KINDS.repeated.priority, 'high');
});

test('the administration\'s bell shows both; a receptionist\'s shows neither', () => {
  const manager = { role: 'manager', permissions: ['manage_sales_team'] };
  const types = visibleBroadcastTypes(manager);
  assert.ok(types.includes('escalation_critical') && types.includes('escalation_repeated'));
  const desk = visibleBroadcastTypes({ role: 'reception_daqqi', permissions: [] });
  assert.ok(!desk.includes('escalation_critical') && !desk.includes('escalation_repeated'));
});

test('escalating writes both the broadcast and the kind on the ticket; the page asks which kind', () => {
  const route = read('api/routes/support.js');
  const escalate = route.slice(route.indexOf("router.post('/api/admin/tickets/:id/escalate'"));
  assert.match(escalate, /escalation_kind=\?/);
  assert.match(escalate, /insertNotification\(conn, note\.type, note\.title, note\.message, data, req\.tenantId, null\)/);
  assert.match(read('api/migrations/284_v26_escalation_kind.sql'), /ADD COLUMN IF NOT EXISTS escalation_kind/);
  const dialog = read('admin/pages/dashboard/tabs/TicketEscalateDialog.tsx');
  assert.match(dialog, /مهم جدا/);
  assert.match(dialog, /متكررة/);
});
