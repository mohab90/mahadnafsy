'use strict';

// deploy/mahad-db-backup.sh takes a lock (flock -n): the hourly cron, a run by hand and root's old crontab line can overlap, and an overlapping run must do nothing and
// say so, with the exit status unchanged (0) — the run that holds the lock answers for the backup. A lock that cannot be taken at all (no flock, an unwritable lock
// file) must never stop a backup.
//
// The script runs for real under bash with mysql, mysqldump and (where a case needs it) flock replaced by stubs on PATH, so nothing touches a database.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.join(__dirname, '..', '..');
const BACKUP = path.join(repoRoot, 'deploy', 'mahad-db-backup.sh');
const RELEASE = path.join(repoRoot, 'deploy-release.sh');
const hasBash = spawnSync('bash', ['-c', 'command -v gzip gunzip find stat date seq'], { encoding: 'utf8' }).status === 0;
const hasRealFlock = hasBash && spawnSync('bash', ['-c', 'command -v flock'], { encoding: 'utf8' }).status === 0;
const skip = hasBash ? false : 'needs bash with GNU coreutils';

const stub = (bin, name, body) => {
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
};

function sandbox({ flockExit } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-lock-'));
  const bin = path.join(dir, 'bin');
  stub(bin, 'mysqldump', 'echo "mysqldump $*" >> "$CALLS"; for i in $(seq 1 60); do echo "CREATE TABLE t$i (id int);"; done');
  stub(bin, 'mysql', 'echo 0');
  stub(bin, 'logger', 'true');
  if (flockExit !== undefined) stub(bin, 'flock', `echo "flock $*" >> "$CALLS"; exit ${flockExit}`);
  const log = path.join(dir, 'backup.log');
  const calls = path.join(dir, 'calls.log');
  const run = (extraEnv = {}) => {
    const result = spawnSync('bash', [BACKUP], {
      encoding: 'utf8',
      env: {
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        HOME: dir, TMPDIR: dir, CALLS: calls,
        MAHAD_BACKUP_ENV_FILE: path.join(dir, 'none.env'),
        MAHAD_BACKUP_DIR: path.join(dir, 'backups'),
        MAHAD_BACKUP_LOG: log,
        MAHAD_BACKUP_LOCK: path.join(dir, 'backup.lock'),
        MAHAD_BACKUP_MIN_BYTES: '1',
        MAHAD_BACKUP_ALLOW_LOCAL_ONLY: '1',
        MAHAD_OFFSITE_ENV_FILE: path.join(dir, 'no-offsite.env'),
        ...extraEnv,
      },
    });
    return {
      status: result.status,
      out: result.stdout + result.stderr,
      log: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '',
      calls: fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '',
    };
  };
  return { dir, run, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('both scripts parse', { skip }, () => {
  for (const file of [BACKUP, RELEASE]) {
    const result = spawnSync('bash', ['-n', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${path.basename(file)}: ${result.stderr}`);
  }
});

test('a run that finds the lock held dumps nothing, logs a SKIPPED line and exits 0', { skip }, () => {
  const s = sandbox({ flockExit: 1 });
  try {
    const r = s.run();
    assert.equal(r.status, 0, r.out + r.log);
    assert.match(r.log, /SKIPPED: another backup run holds .*backup\.lock; this one did nothing/);
    assert.doesNotMatch(r.calls, /mysqldump/, 'a skipped run must not start a dump');
    assert.match(r.calls, /flock -n 9/, 'the lock is taken without waiting (flock -n)');
  } finally { s.done(); }
});

test('a run that gets the lock backs up as it always did', { skip }, () => {
  const s = sandbox({ flockExit: 0 });
  try {
    const r = s.run();
    assert.equal(r.status, 0, r.out + r.log);
    assert.match(r.calls, /mysqldump .*mahadnafsy_db/);
    assert.match(r.log, /backup ok: .*\.sql\.gz/);
    assert.doesNotMatch(r.log, /SKIPPED|WARNING no lock/);
  } finally { s.done(); }
});

test('exit statuses are unchanged: a failed dump is still 1, no off-site destination still 3', { skip }, () => {
  const s = sandbox({ flockExit: 0 });
  try {
    stub(path.join(s.dir, 'bin'), 'mysqldump', 'echo "mysqldump $*" >> "$CALLS"; exit 2');
    const failed = s.run();
    assert.equal(failed.status, 1, failed.out + failed.log);
    assert.match(failed.log, /BACKUP FAILED: mysqldump\/gzip returned non-zero/);

    stub(path.join(s.dir, 'bin'), 'mysqldump', 'echo "mysqldump $*" >> "$CALLS"; for i in $(seq 1 60); do echo "CREATE TABLE t$i (id int);"; done');
    const noOffsite = s.run({ MAHAD_BACKUP_ALLOW_LOCAL_ONLY: '0' });
    assert.equal(noOffsite.status, 3, noOffsite.out + noOffsite.log);
  } finally { s.done(); }
});

test('a lock file that cannot be opened never stops the backup, it only warns', { skip }, () => {
  const s = sandbox({ flockExit: 0 });
  try {
    const r = s.run({ MAHAD_BACKUP_LOCK: path.join(s.dir, 'no-such-folder', 'deeper', 'backup.lock') });
    assert.equal(r.status, 0, r.out + r.log);
    assert.match(r.log, /WARNING no lock: flock is missing or .* is not writable/);
    assert.match(r.log, /backup ok:/);
  } finally { s.done(); }
});

test('with the real flock, a second run while the first holds the lock is skipped', { skip: skip || (hasRealFlock ? false : 'needs flock') }, async () => {
  const s = sandbox();
  const lock = path.join(s.dir, 'backup.lock');
  const holder = spawn('bash', ['-c', 'exec 9>"$L"; flock -n 9 && echo held && sleep 6'], { env: { ...process.env, L: lock }, stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    await new Promise((resolve, reject) => {
      holder.stdout.once('data', resolve);
      holder.once('error', reject);
      setTimeout(() => reject(new Error('the holder never took the lock')), 5000);
    });
    const r = s.run();
    assert.equal(r.status, 0, r.out + r.log);
    assert.match(r.log, /SKIPPED: another backup run holds/);
    assert.doesNotMatch(r.calls, /mysqldump/);
  } finally { holder.kill(); s.done(); }
});

test('deploy-release.sh prints the old crontab line it found, and how to remove it', () => {
  const source = fs.readFileSync(RELEASE, 'utf8');
  assert.match(source, /OLD_CRON=\$\(crontab -l 2>\/dev\/null \| grep 'mahad-db-backup'/);
  assert.match(source, /printf '%s\\n' "\$OLD_CRON"/, 'the line found is printed as it is');
  assert.match(source, /crontab -l > \/root\/crontab\.bak\./, 'the removal starts with a backup of the crontab');
});
