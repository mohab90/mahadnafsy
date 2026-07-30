'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  applyDeliveryStatus,
  eventDate,
  normalizeDeliveryStatus,
} = require('../lib/whatsappDelivery');

test('WhatsApp provider statuses normalize to the delivery lifecycle', () => {
  assert.equal(normalizeDeliveryStatus('sent'), 'sent');
  assert.equal(normalizeDeliveryStatus('delivered'), 'delivered');
  assert.equal(normalizeDeliveryStatus('read'), 'read');
  assert.equal(normalizeDeliveryStatus('yellowCard'), 'failed');
  assert.equal(normalizeDeliveryStatus('noAccount'), 'failed');
  assert.equal(normalizeDeliveryStatus('unknown'), null);
  assert.equal(eventDate(1_700_000_000).toISOString(), '2023-11-14T22:13:20.000Z');
});

test('delivery receipt updates only a matching provider message and preserves monotonic status', async () => {
  let captured;
  const db = {
    async query(sql, params) {
      captured = { sql, params };
      return [{ affectedRows: 1 }];
    },
  };
  assert.equal(await applyDeliveryStatus({
    provider: 'meta',
    messageId: 'wamid.123',
    status: 'delivered',
    timestamp: 1_700_000_000,
  }, db), true);
  assert.match(captured.sql, /provider_message_id=\?/);
  assert.match(captured.sql, /FIELD\(\?, 'accepted','sent','delivered','read'\)/);
  assert.deepEqual(captured.params.slice(-2), ['meta', 'wamid.123']);
});

test('outbox and signed webhook routes persist provider acceptance and receipts', () => {
  const root = path.join(__dirname, '..');
  const outbox = fs.readFileSync(path.join(root, 'lib', 'outbox.js'), 'utf8');
  const route = fs.readFileSync(path.join(root, 'routes', 'whatsapp-webhook.js'), 'utf8');
  const migration = fs.readFileSync(path.join(root, 'migrations', '147_v25_whatsapp_delivery_receipts.sql'), 'utf8');
  assert.match(outbox, /delivery\?\.ok === false/);
  assert.match(outbox, /provider_message_id/);
  assert.match(route, /x-hub-signature-256/);
  assert.match(route, /WHATSAPP_GREEN_WEBHOOK_SECRET/);
  assert.match(migration, /uq_outbox_provider_message/);
});
