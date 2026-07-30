'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('database backup has one shell-free atomic implementation with integrity evidence', () => {
  const server = read('server.js');
  const scheduler = read('lib/backgroundScheduler.js');
  const backup = read('lib/dbBackup.js');
  assert.equal((scheduler.match(/scheduleDbBackup\(\)/g) || []).length, 1);
  assert.doesNotMatch(server, /autoDailyBackup|execSync\([^)]*mysqldump|DB_PASS\b/);
  assert.match(backup, /spawn\(process\.env\.MYSQLDUMP_PATH \|\| 'mysqldump'/);
  assert.match(backup, /MYSQL_PWD/);
  assert.match(backup, /\.partial/);
  assert.match(backup, /sha256File/);
  assert.match(backup, /\.sha256/);
  assert.doesNotMatch(backup, /shell:\s*true|execSync|readFileSync\(partial\)/);
});

test('restore rehearsal is opt-in, uses a generated database and always drops it', () => {
  const rehearsal = read('tools/backup-restore-rehearsal.cjs');
  assert.match(rehearsal, /ALLOW_DB_RESTORE_REHEARSAL/);
  assert.match(rehearsal, /mahad_restore_rehearsal_\$\{process\.pid\}/);
  assert.match(rehearsal, /CREATE DATABASE/);
  assert.match(rehearsal, /DROP DATABASE IF EXISTS/);
  assert.match(rehearsal, /checksumsMatch/);
  assert.match(rehearsal, /countsMatch/);
});
