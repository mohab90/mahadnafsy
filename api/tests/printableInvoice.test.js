'use strict';
/**
 * The printable invoice (GET /api/admin/payments/:id/invoice-html), called for real against a database that answers by pattern:
 * what it draws from stored data is escaped, and a payment that is not there (or not in the caller's scope) is a 404 with no page.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { callRoute, fakePool } = require('./support/routes');
const router = require('../routes/misc/billing');

const PAYMENT = {
  id: 'pay-1', tenant_id: 't-routes', amount: 1500, currency: 'EGP', status: 'paid', method: 'كاش', created_at: '2026-11-01 10:00:00', date: '2026-11-01',
  client_name: '<img src=x onerror=alert(1)>', client_code: 'C"1', client_phone: '010', client_email: 'a@b.test', branch: 'ONLINE_EGYPT',
};

test('an invoice draws the client and the institute escaped, never as markup', async () => {
  const db = fakePool([
    [/FROM payments p/, [PAYMENT]],
    [/tenant_settings|site_config/, [{ value: JSON.stringify({ site_name: '<b>المعهد</b>' }), setting_value: JSON.stringify({ site_name: '<b>المعهد</b>' }) }]],
  ]);
  try {
    const res = await callRoute(router, 'get', '/api/admin/payments/:id/invoice-html', { superAdmin: true, params: { id: 'pay-1' } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const html = String(res.body);
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'the client name is text');
    assert.ok(!html.includes('<img src=x'), 'and nothing of it is a tag');
    assert.ok(!html.includes('<b>المعهد</b>'), 'the institute\'s own name is escaped too');
    const read = db.calls.find(call => /FROM payments p/.test(call.sql));
    assert.deepEqual(read.params, ['pay-1', 't-routes'], 'the payment is asked for by id inside the caller\'s institute');
  } finally { db.restore(); }
});

test('a payment that is not there is a 404 and no page', async () => {
  const db = fakePool([[/FROM payments p/, []]]);
  try {
    const res = await callRoute(router, 'get', '/api/admin/payments/:id/invoice-html', { superAdmin: true, params: { id: 'nope' } });
    assert.equal(res.status, 404);
    assert.equal(typeof res.body, 'object');
  } finally { db.restore(); }
});

test('the reminder sweep is the one reader of the day\'s follow-ups: no route lists them', () => {
  // The «due-today» route was removed on 3 Nov 2026 — nothing called it.
  const router = require('../routes/misc/reminders');
  const paths = router.stack.filter(layer => layer.route).map(layer => layer.route.path);
  assert.ok(!paths.includes('/api/admin/leads/due-today'), 'the route is gone');
  assert.ok(typeof require('../routes/misc/_shared').runFollowUpReminders === 'function', 'and the sweep that reads the follow-ups is there');
});
