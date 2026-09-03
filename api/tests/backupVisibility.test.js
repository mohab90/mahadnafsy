'use strict';
// The screen that tells you whether your backups are safe has to be looking at
// the backups.
//
// It was not. The route defaulted BACKUP_DIR to /tmp/mahad_backups, which does
// not exist on the server, while the cron script writes to /var/backups/mahad-db
// — where 23 healthy daily dumps were sitting. BACKUP_DIR was never set, so the
// screen showed nothing, and would have shown exactly the same nothing if the
// backups had genuinely been failing.
//
// It also reported "last backup at" from a site_config row that only the
// "backup now" button writes, so the date shown was the last time a human
// clicked, not the last time a backup was taken.
//
// The pairing below is the actual defect class: two components naming the same
// directory independently and disagreeing. This test fails if they drift again.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Comments are blanked before matching. Both assertions below name the thing
// they forbid, and the code's own explanation of the fix names it too — the
// fourth time in this suite that a comment has answered an assertion about the
// code.
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n')
  .map(line => (/^\s*(\/\/|#|\*)/.test(line) ? '' : line.split('//')[0]))
  .join('\n');

const route = codeOnly(fs.readFileSync(
  path.join(__dirname, '..', 'routes', 'admin-utils.js'), 'utf8'));
const script = fs.readFileSync(
  path.join(__dirname, '..', '..', 'deploy', 'mahad-db-backup.sh'), 'utf8');

const defaultDirIn = source => {
  const match = source.match(/(?:MAHAD_BACKUP_DIR:-|'|")(\/var\/backups\/mahad-db)/);
  return match ? match[1] : null;
};

test('the route and the cron script name the same backup directory', () => {
  const fromScript = defaultDirIn(script);
  assert.ok(fromScript, 'the backup script no longer names a default directory');

  const fromRoute = defaultDirIn(route);
  assert.ok(fromRoute, 'the route no longer names a default backup directory');
  assert.equal(fromRoute, fromScript,
    'the backup screen is pointed somewhere the backup script does not write');

  // The old default is the specific wrong answer this exists to prevent —
  // including in the download route, which kept its own copy of it and so went
  // on looking in a directory that does not exist after the rest was fixed.
  assert.doesNotMatch(route, /'\/tmp\/mahad_backups'/);
  assert.equal((route.match(/const BACKUP_DIR\s*=/g) || []).length, 1,
    'BACKUP_DIR is declared more than once — a second copy can hold a different path');
});

test('a backup can actually be downloaded', () => {
  const download = route.slice(route.indexOf("router.get('/api/admin/backups/download/:filename'"));
  assert.ok(download.length > 200, 'the download handler was not located');

  // The guard was /^mahad_backup_[\w.-]+\.sql(\.gz)?$/ while the files are
  // named mahadnafsy_db_<stamp>.sql.gz, so every real backup was refused as an
  // invalid filename. The name is now checked against the directory listing,
  // which also rules out traversal without depending on a pattern.
  assert.doesNotMatch(download, /mahad_backup_/);
  assert.match(download, /available\.files\.some\(file => file\.name === filename\)/);

  const realName = 'mahadnafsy_db_20260903_032002.sql.gz';
  assert.doesNotMatch(realName, /^mahad_backup_[\w.-]+\.sql(\.gz)?$/,
    'the old pattern would have matched the real filename after all');
});

test('backup status is read from the files, not from a button someone pressed', () => {
  const status = route.slice(
    route.indexOf("router.get('/api/admin/backup-status'"),
    route.indexOf("router.post('/api/admin/backup-now'"));
  assert.ok(status.length > 200, 'the backup-status handler was not located');

  assert.match(status, /readBackupFiles\(\)/);
  assert.doesNotMatch(status, /site_config/,
    'status is back to reporting a config value instead of the backups themselves');
  assert.match(status, /lastBackupAt: newest\?\.at \|\| null/);
});

test('an empty archive is reported as a failure, not as a backup', () => {
  // Four 20-byte .gz files — valid archives of nothing — were left behind by an
  // earlier version of the script that treated a failed mysqldump as success.
  // A size floor is what separates those from a real dump.
  assert.match(route, /MIN_CREDIBLE_BYTES/);
  assert.match(route, /credible: stat\.size >= MIN_CREDIBLE_BYTES/);
  assert.match(route, /undersizedFiles/);
  assert.match(route, /staleOrMissing/);

  // And the script must still refuse to keep one.
  assert.match(script, /MIN_BYTES/);
});
