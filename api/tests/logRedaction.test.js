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

test('runtime application code cannot bypass the structured logger with console calls', () => {
  const roots = ['lib', 'middleware', 'routes'];
  const violations = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.name.endsWith('.js') && target !== path.join(__dirname, '..', 'lib', 'logger.js')) {
        const source = fs.readFileSync(target, 'utf8');
        if (/console\.(?:log|warn|error|debug)\s*\(/.test(source)) violations.push(path.relative(path.join(__dirname, '..'), target));
      }
    }
  };
  roots.forEach(root => walk(path.join(__dirname, '..', root)));
  assert.deepEqual(violations, []);
});
