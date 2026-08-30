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

test('the MySQL-only dump flag is conditional, because MariaDB refuses to start with it', () => {
  const backup = read('lib/dbBackup.js');
  // --set-gtid-purged is a MySQL option. MariaDB does not ignore it, it exits 7
  // with "unknown variable" — which it did 96 times into an empty directory
  // while the assertions above stayed green, because they check the shape of
  // the implementation and never that a dump comes out of the end of it.
  // Assert where the flag is used, not merely that a helper exists somewhere in
  // the file: an earlier version of this test checked for the helper's presence
  // and passed while the flag sat unconditionally in the argument list.
  const occurrences = backup.match(/--set-gtid-purged=OFF/g) || [];
  assert.equal(occurrences.length, 1, 'the flag belongs only inside the capability check');
  assert.match(
    backup,
    /\.\.\.\(\s*supportsGtidPurged\(\)\s*\?\s*\['--set-gtid-purged=OFF'\]\s*:\s*\[\]\s*\),/,
    'the flag must reach the arguments only through supportsGtidPurged()',
  );
  // The capability is decided by asking the binary, not by guessing from env.
  assert.match(backup, /spawnSync\([^)]*MYSQLDUMP_PATH[^)]*\|\| 'mysqldump', \['--help'\]/);
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
