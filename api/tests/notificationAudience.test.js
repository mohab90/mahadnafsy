'use strict';

// «سيسيتم الاشعارات لازم يتصلح بشكل جيد جدا للادارة وللموظفين». On 30 Sep 2026
// the bell carried other people's work: 1,182 lead-assignment broadcasts in a
// week, one per lead, naming whoever got it; 1,355 failed-delivery alerts to
// everyone; payments to every holder of manage_payments — every role.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { visibleBroadcastTypes } = require('../lib/notificationAudience');
const { coalesceNotification } = require('../lib/notification');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const sees = (role, type) => visibleBroadcastTypes({ role }).includes(type);

test('a broadcast reaches the people it is about, not everyone', () => {
  for (const type of ['payment', 'lead', 'subscriber', 'delivery_failed', 'ticket', 'refund']) {
    assert.equal(sees('sales', type), false, `a sales rep sees every ${type} broadcast`);
  }
  assert.equal(sees('hr', 'payment'), false, 'manage_payments, which every role holds for booking, is not an audience');
  assert.equal(sees('online_manager', 'lead'), true, 'management sees the leads waiting for distribution');
  assert.equal(sees('support', 'ticket'), true, 'customer service sees ticket escalations');
  assert.equal(sees('support', 'consultation'), true);
  assert.equal(sees('collection', 'payment'), true);
  assert.equal(sees('online_manager', 'delivery_failed'), false, 'a broken channel is for whoever can fix its settings');
  assert.equal(sees('manager', 'delivery_failed'), true);
});

test('the bell counts every unread it can show, over the last 30 days', () => {
  const route = read('api/routes/notifications.js');
  assert.match(route, /const WINDOW_SQL = ' AND n\.created_at >= NOW\(\) - INTERVAL 30 DAY';/);
  assert.match(route, /SELECT COUNT\(\*\) AS unread/);
  assert.ok(!route.includes('rows.filter(r => !r.read_at).length'), 'counted from the 100 rows sent');
});

test('a burst of the same notification is one line with a count', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/^\s*SELECT n\.id, n\.data_json FROM notifications n/.test(sql)) return [[{ id: 'n1', data_json: '{"count":6}' }]];
      return [{ affectedRows: 1 }];
    },
  };
  const folded = await coalesceNotification(db, {
    type: 'lead', title: '👤 ليدز اتعينت ليك', data: { lastName: 'منى' }, tenantId: 't', recipientStaffId: 's1',
    minutes: 30, summarize: (count, data) => `اتعين ليك ${count} ليد — آخرهم ${data.lastName}`,
  });
  assert.equal(folded, true);
  const update = calls.find(call => /^UPDATE notifications SET message=\?/.test(call.sql));
  assert.equal(update.params[0], 'اتعين ليك 7 ليد — آخرهم منى');
  assert.match(calls[0].sql, /NOT EXISTS \(SELECT 1 FROM notification_reads/, 'a line already read starts a new one');
});

test('lead notifications go to the rep concerned, or to management while nobody has the lead', () => {
  const leads = read('api/routes/admin/leads.js');
  assert.ok(!leads.includes("'👤 تعيين ليد'"), 'the per-lead broadcast to all of sales');
  assert.match(leads, /createNotification\('lead', '👤 ليدز اتعينت ليك',[\s\S]{0,120}tenantId, crmData\.assignedSalesId,/);
  assert.match(leads, /createNotification\('lead', '📋 ليدز جديدة ليك', leadLine,[\s\S]{0,80}tenantId, salesId,/);
  assert.match(read('api/routes/misc/_shared.js'), /tenantId, lead\.assigned_sales_id \|\| null,/, 'a follow-up reminder is its rep\'s');
  assert.match(read('api/routes/subscriber-payments.js'), /'💰 دفعة جديدة', `\$\{subRow\.name \|\| 'عميل'\}/, 'a payment names its client');
  assert.match(read('api/lib/outbox.js'), /coalesceMinutes: 24 \* 60/, 'an outage is one line a day');
});
