'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getDbSslConfig } = require('../lib/dbSsl');

test('database TLS is disabled only when explicitly configured that way', () => {
  assert.equal(getDbSslConfig({ DB_SSL_MODE: 'disabled' }), undefined);
  assert.deepEqual(getDbSslConfig({ DB_SSL_MODE: 'required' }), { rejectUnauthorized: false });
});

test('verify-ca fails closed without a trusted CA', () => {
  assert.throws(() => getDbSslConfig({ DB_SSL_MODE: 'verify-ca' }), /DB_SSL_CA_PATH/);
  assert.throws(() => getDbSslConfig({ DB_SSL_MODE: 'typo' }), /DB_SSL_MODE/);
});
