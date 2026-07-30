'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sendAbandonedCheckoutReminders } = require('../lib/abandonedCheckout');

function fixtureDb(orders) {
  const writes = [];
  return {
    writes,
    async query(sql, params) {
      if (sql.includes('FROM orders o')) return [orders];
      writes.push({ sql, params });
      return [{ affectedRows: 1 }];
    },
  };
}

const order = {
  id: 'order-1',
  tenant_id: 'tenant-1',
  item_title: 'Course',
  amount: 500,
  currency: 'EGP',
  customer_name: 'Client',
  customer_phone: '01000000000',
  customer_email: 'client@example.test',
};

test('abandoned checkout respects WhatsApp suppression and records a deduping skip', async () => {
  const db = fixtureDb([order]);
  let sends = 0;
  const stats = await sendAbandonedCheckoutReminders(
    { delayMs: 0 },
    {
      db,
      filterSuppressed: async () => [],
      sendWhatsApp: async () => { sends += 1; return { ok: true }; },
    }
  );
  assert.deepEqual(stats, { scanned: 1, sent: 0, failed: 0, skipped: 1 });
  assert.equal(sends, 0);
  assert.equal(db.writes[0].params[5], 'skipped');
  assert.equal(db.writes[0].params[6], 'marketing suppressed');
});

test('abandoned checkout never records a provider rejection as sent', async () => {
  const db = fixtureDb([order]);
  const stats = await sendAbandonedCheckoutReminders(
    { delayMs: 0 },
    {
      db,
      filterSuppressed: async (_tenant, _channel, rows) => rows,
      sendWhatsApp: async () => ({ ok: false, reason: 'not_configured' }),
    }
  );
  assert.deepEqual(stats, { scanned: 1, sent: 0, failed: 1, skipped: 0 });
  assert.equal(db.writes[0].params[5], 'failed');
  assert.equal(db.writes[0].params[6], 'not_configured');
});

test('abandoned checkout records sent only after provider acceptance', async () => {
  const db = fixtureDb([order]);
  const stats = await sendAbandonedCheckoutReminders(
    { delayMs: 0 },
    {
      db,
      filterSuppressed: async (_tenant, _channel, rows) => rows,
      sendWhatsApp: async () => ({ ok: true, idMessage: 'provider-1' }),
    }
  );
  assert.deepEqual(stats, { scanned: 1, sent: 1, failed: 0, skipped: 0 });
  assert.equal(db.writes[0].params[5], 'sent');
});
