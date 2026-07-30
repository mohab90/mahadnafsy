'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('login releases its DB connection before bcrypt and pool-backed audit writes', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8');
  const login = source.slice(
    source.indexOf("router.post('/api/auth/login'"),
    source.indexOf("router.post('/api/auth/logout'")
  );
  const release = login.indexOf('conn.release();');
  const compare = login.indexOf('bcrypt.compare');
  const successAudit = login.lastIndexOf('logLoginAttempt');
  assert.ok(release > 0);
  assert.ok(compare > release);
  assert.ok(successAudit > compare);
});

test('production template reserves a bounded native bcrypt worker pool', () => {
  const env = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
  assert.match(env, /^UV_THREADPOOL_SIZE=8$/m);
});
