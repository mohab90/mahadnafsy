'use strict';
// These credentials let someone send messages as a named employee, so the
// properties that matter are: a dump of the table is useless without the key,
// and a tampered row fails loudly instead of yielding altered credentials.
const { test } = require('node:test');
const assert = require('node:assert');

process.env.CHANNEL_SECRET_KEY = process.env.CHANNEL_SECRET_KEY || 'test-key-at-least-sixteen-chars-long';
const { seal, open, isConfigured, _resetKeyCache } = require('../lib/secretBox');

test('a sealed credential comes back exactly as it went in', () => {
  const creds = { instanceId: '110000', apiToken: 'abc123', nested: { a: [1, 2, 'ثلاثة'] } };
  assert.deepEqual(open(seal(creds)), creds);
});

test('the plaintext never appears in the sealed form', () => {
  const sealed = seal({ apiToken: 'super-secret-token-value' });
  assert.ok(!sealed.includes('super-secret-token-value'), 'token leaked into the stored value');
  assert.ok(!sealed.includes('apiToken'), 'even the key names must not be readable');
});

test('sealing the same value twice produces different ciphertext', () => {
  // A fixed IV would let anyone spot two employees sharing one credential just
  // by comparing rows.
  const value = { apiToken: 'same' };
  assert.notEqual(seal(value), seal(value));
});

test('a tampered ciphertext is rejected rather than decrypted', () => {
  const sealed = seal({ apiToken: 'original' });
  const parts = sealed.split(':');
  const data = Buffer.from(parts[3], 'base64url');
  data[0] ^= 0xff;
  parts[3] = data.toString('base64url');
  assert.throws(() => open(parts.join(':')), /unable to authenticate|bad decrypt|Unsupported state/i);
});

test('a swapped authentication tag is rejected', () => {
  const a = seal({ apiToken: 'a' }).split(':');
  const b = seal({ apiToken: 'b' }).split(':');
  a[2] = b[2];
  assert.throws(() => open(a.join(':')));
});

test('a malformed envelope is rejected before any crypto runs', () => {
  for (const bad of ['nonsense', 'v1:only:three', 'v2:a:b:c', 'v1:::']) {
    assert.throws(() => open(bad), /Unrecognised credential format|Malformed credential envelope|base64|Invalid/i, bad);
  }
});

test('an empty credential is null, not an error', () => {
  // A channel row can legitimately exist before it is connected.
  assert.equal(open(null), null);
  assert.equal(open(''), null);
  assert.equal(open(undefined), null);
});

test('null and empty objects survive the round trip', () => {
  assert.equal(open(seal(null)), null);
  assert.deepEqual(open(seal({})), {});
});

test('a credential sealed under one key cannot be opened with another', () => {
  // The failure mode this protects against: restoring a database into a
  // different environment must not hand over working credentials.
  const sealed = seal({ apiToken: 'x' });
  const original = process.env.CHANNEL_SECRET_KEY;
  try {
    process.env.CHANNEL_SECRET_KEY = 'a-completely-different-key-value-here';
    _resetKeyCache();
    assert.throws(() => open(sealed));
  } finally {
    process.env.CHANNEL_SECRET_KEY = original;
    _resetKeyCache();
  }
});

test('a key shorter than 16 characters is refused outright', () => {
  const original = process.env.CHANNEL_SECRET_KEY;
  const originalJwt = process.env.JWT_SECRET;
  try {
    process.env.CHANNEL_SECRET_KEY = 'short';
    process.env.JWT_SECRET = '';
    _resetKeyCache();
    assert.throws(() => seal({ a: 1 }), /at least 16 characters/);
    assert.equal(isConfigured(), false);
  } finally {
    process.env.CHANNEL_SECRET_KEY = original;
    if (originalJwt === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalJwt;
    _resetKeyCache();
  }
});
