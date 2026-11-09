'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const logger = require('../lib/logger');

test('structured logger recursively removes secrets and common PII', () => {
  const result = logger.redact({
    email: 'person@example.com',
    nested: {
      password: 'clear-text',
      note: 'contact person@example.com at +20 100 123 4567 from 192.168.1.10',
      authorization: 'Bearer abc.def.ghi',
    },
    url: 'https://user:pass@example.com/callback?token=sensitive',
  });
  assert.equal(result.email, '[REDACTED]');
  assert.equal(result.nested.password, '[REDACTED]');
  assert.equal(result.nested.authorization, '[REDACTED]');
  assert.doesNotMatch(JSON.stringify(result), /person@example|clear-text|100 123|192\.168|sensitive|user:pass/);
});
