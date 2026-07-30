'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { preserveStoredSecrets, redactSecrets } = require('../lib/configSecrets');
const { isPaymobActive } = require('../lib/saasSettings');

test('system config responses redact nested and list secrets', () => {
  const redacted = redactSecrets({
    paymob: { api_key: 'key', merchant_id: 'merchant' },
    api_sources: [{ id: 'a', secret: 'source-secret', name: 'source' }],
  });
  assert.deepEqual(redacted, {
    paymob: { api_key: '', merchant_id: 'merchant' },
    api_sources: [{ id: 'a', secret: '', name: 'source' }],
  });
});

test('blank secret fields preserve stored values by object key and list id', () => {
  const stored = {
    paymob: { api_key: 'old-key', merchant_id: 'old-merchant' },
    api_sources: [{ id: 'a', secret: 'old-secret', name: 'old' }],
  };
  const incoming = {
    paymob: { api_key: '', merchant_id: 'new-merchant' },
    api_sources: [{ id: 'a', secret: '', name: 'new' }],
  };
  assert.deepEqual(preserveStoredSecrets(stored, incoming), {
    paymob: { api_key: 'old-key', merchant_id: 'new-merchant' },
    api_sources: [{ id: 'a', secret: 'old-secret', name: 'new' }],
  });
});

test('Paymob remains fail-closed while provider review is pending', () => {
  const previous = process.env.PAYMOB_REVIEW_PENDING;
  try {
    process.env.PAYMOB_REVIEW_PENDING = 'true';
    assert.equal(isPaymobActive({ active_provider: 'paymob', paymob: { enabled: true } }), false);
    process.env.PAYMOB_REVIEW_PENDING = 'false';
    assert.equal(isPaymobActive({ active_provider: 'paymob', paymob: { enabled: true } }), true);
  } finally {
    if (previous === undefined) delete process.env.PAYMOB_REVIEW_PENDING;
    else process.env.PAYMOB_REVIEW_PENDING = previous;
  }
});

test('legacy Paymob order reservation fails before any database mutation while disabled', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'public-orders.js'), 'utf8');
  const reserve = route.slice(route.indexOf("router.post('/api/orders/reserve'"));
  assert.ok(reserve.indexOf('if (!isPaymobActive(config))') < reserve.indexOf('await pool.getConnection()'));
});
