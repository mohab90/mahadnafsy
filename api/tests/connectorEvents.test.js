'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  enqueueConnectorEvent,
  drainConnectorEvents,
  MAX_ATTEMPTS,
} = require('../lib/connectorEvents');
const { leadFields } = require('../lib/facebookLeadEvents');

test('connector inbox insert is idempotent by tenant/provider/external identity', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/INSERT IGNORE/.test(sql)) return [{ affectedRows: 0 }];
      return [[{ id: 'existing', status: 'processed' }]];
    },
  };
  const result = await enqueueConnectorEvent({
    tenantId: 'tenant-a', provider: 'facebook_leads', externalEventId: 'evt-1', payload: { ok: true },
  }, db);
  assert.deepEqual(result, { id: 'existing', duplicate: true, status: 'processed' });
  assert.match(calls[0].sql, /INSERT IGNORE INTO connector_events/);
  assert.deepEqual(calls[0].params.slice(1, 4), ['tenant-a', 'facebook_leads', 'evt-1']);
});

test('connector worker claims then marks a successfully handled event processed', async () => {
  const updates = [];
  const row = {
    id: 'event-a', tenant_id: 'tenant-a', provider: 'facebook_leads',
    payload_json: JSON.stringify({ object: 'page' }), attempts: 0,
  };
  const conn = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql) {
      if (/SELECT \* FROM connector_events/.test(sql)) return [[row]];
      return [{ affectedRows: 1 }];
    },
  };
  const db = {
    async getConnection() { return conn; },
    async query(sql, params) { updates.push({ sql, params }); return [{ affectedRows: 1 }]; },
  };
  let handled = 0;
  const result = await drainConnectorEvents({
    facebook_leads: async ({ event, payload }) => {
      assert.equal(event.id, 'event-a');
      assert.equal(payload.object, 'page');
      handled += 1;
    },
  }, { db });
  assert.deepEqual(result, { claimed: 1, processed: 1 });
  assert.equal(handled, 1);
  assert.match(updates[0].sql, /status='processed'/);
  assert.equal(MAX_ATTEMPTS, 8);
});

test('Facebook lead field mapping is deterministic and connector route persists before acknowledgement', () => {
  assert.deepEqual(leadFields({
    field_data: [
      { name: 'full_name', values: ['Client'] },
      { name: 'phone_number', values: ['0100'] },
      { name: 'email', values: ['client@example.com'] },
    ],
  }), { name: 'Client', phone: '0100', email: 'client@example.com' });
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'facebook-leads-webhook.js'), 'utf8');
  const diagnostics = fs.readFileSync(path.join(__dirname, '..', 'routes', 'connector-diagnostics.js'), 'utf8');
  const postRoute = route.slice(route.indexOf("router.post('/api/webhooks/facebook-leads'"));
  assert.match(route, /enqueueConnectorEvent/);
  assert.ok(postRoute.indexOf('await enqueueConnectorEvent') < postRoute.indexOf('res.status(accepted'));
  assert.match(route, /x-hub-signature-256/);
  assert.match(diagnostics, /connectors\/events\/:id\/replay/);
  assert.match(diagnostics, /status IN \('failed','dead'\)/);
});
