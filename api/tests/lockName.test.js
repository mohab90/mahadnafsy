'use strict';
/**
 * Named locks are per database (lib/lockName.js). MariaDB's GET_LOCK names are
 * server-wide, and staging (mahadnafsy_test) on the production MariaDB held
 * 'mahad:wa-web' — production answered «خدمة الواتساب بتشتغل دلوقتي» forever.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('two databases get two different locks, never longer than 64 characters', () => {
  const { scopedLockName } = require('../lib/lockName');
  const saved = process.env.DB_NAME;
  try {
    process.env.DB_NAME = 'mahadnafsy_db';
    const prod = scopedLockName('mahad:wa-web');
    process.env.DB_NAME = 'mahadnafsy_test';
    const staging = scopedLockName('mahad:wa-web');
    assert.notEqual(prod, staging);
    assert.equal(prod, 'mahadnafsy_db:mahad:wa-web');
    assert.ok(scopedLockName(`job:${'x'.repeat(80)}`).length <= 64);
  } finally { process.env.DB_NAME = saved; }
});

test('the long-held locks use it: WhatsApp sessions, scheduled jobs, timer jobs', () => {
  const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  assert.match(read('lib/whatsappWeb.js'), /scopedLockName\('mahad:wa-web'\)/);
  assert.match(read('lib/scheduledTenants.js'), /scopedLockName\(`scheduled:\$\{job\}`\)/);
  assert.match(read('lib/jobLock.js'), /scopedLockName\(`job:/);
});
