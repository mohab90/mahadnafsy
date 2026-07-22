'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { preserveStoredSecrets, redactSecrets } = require('../lib/configSecrets');

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
