'use strict';

// Off-site copies: deploy/mahad-offsite.sh and the hourly backup's hand-off to
// it (deploy/mahad-db-backup.sh).
//
// Until these existed every copy of the database lived on the disk the
// database lives on. The tests run the real scripts with rclone, aws, gpg,
// mysql, mysqldump, mysqlbinlog, logger and curl replaced by stubs on PATH:
// the "bucket" is a folder, "encryption" is a marked base64 wrapper that needs
// the passphrase on fd 3, and every call is logged. Nothing reaches a network
// or a database.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.join(__dirname, '..', '..');
const OFFSITE = path.join(repoRoot, 'deploy', 'mahad-offsite.sh');
const BACKUP = path.join(repoRoot, 'deploy', 'mahad-db-backup.sh');
const hasTools = spawnSync('bash', ['-c', 'command -v base64 gzip find stat flock date'], { encoding: 'utf8' }).status === 0;
const skip = process.platform === 'win32' || !hasTools ? 'needs a POSIX bash with GNU coreutils' : false;

const write = (file, body, mode = 0o644) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, { mode });
};
const stub = (bin, name, body) => write(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, 0o755);

const MARK = 'MAHAD-TEST-ENCRYPTED';
const PASSPHRASE = 'correct horse battery staple';

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsite-'));
  const bin = path.join(dir, 'bin');
  const bucket = path.join(dir, 's3');
  fs.mkdirSync(bucket, { recursive: true });

  // The bucket, behind rclone's vocabulary. It refuses unless the remote was
  // described by the environment, the way the script promises.
  stub(bin, 'rclone', `echo "rclone $*" >> "$CALLS"
[ "$RCLONE_CONFIG_MAHADOFFSITE_TYPE" = s3 ] && [ -n "$RCLONE_CONFIG_MAHADOFFSITE_ACCESS_KEY_ID" ] || { echo "no remote" >&2; exit 1; }
p() { case "$1" in mahadoffsite:*) echo "$FAKE_S3/\${1#mahadoffsite:}" ;; *) echo "$1" ;; esac; }
args=(); skipn=0; for a in "$@"; do
  if [ "$skipn" = 1 ]; then skipn=0; continue; fi
  case "$a" in --format|--separator) skipn=1 ;; -*) ;; *) args+=("$a") ;; esac; done
case "\${args[0]}" in
  copyto) [ -n "$RCLONE_FAIL" ] && exit 1; mkdir -p "$(dirname "$(p "\${args[2]}")")"; cp "$(p "\${args[1]}")" "$(p "\${args[2]}")" ;;
  rcat) [ -n "$RCLONE_FAIL" ] && exit 1; mkdir -p "$(dirname "$(p "\${args[1]}")")"; cat > "$(p "\${args[1]}")" ;;
  deletefile) rm -f "$(p "\${args[1]}")" ;;
  lsf) d="$(p "\${args[1]}")"; [ -d "$d" ] || exit 0; (cd "$d" && find . -type f -printf '%P\\t%s\\n') ;;
  *) exit 2 ;;
esac`);
  // The same bucket behind the aws CLI's.
  stub(bin, 'aws', `echo "aws $*" >> "$CALLS"
[ -n "$AWS_ACCESS_KEY_ID" ] && [ -n "$AWS_SECRET_ACCESS_KEY" ] || exit 1
args=(); skipn=0; for a in "$@"; do
  if [ "$skipn" = 1 ]; then skipn=0; continue; fi
  case "$a" in --endpoint-url) skipn=1 ;; --*) ;; *) args+=("$a") ;; esac; done
p() { case "$1" in s3://*) echo "$FAKE_S3/\${1#s3://}" ;; *) echo "$1" ;; esac; }
case "\${args[1]}" in
  cp) if [ "\${args[2]}" = - ]; then mkdir -p "$(dirname "$(p "\${args[3]}")")"; cat > "$(p "\${args[3]}")"
      else mkdir -p "$(dirname "$(p "\${args[3]}")")"; cp "$(p "\${args[2]}")" "$(p "\${args[3]}")"; fi ;;
  rm) rm -f "$(p "\${args[2]}")" ;;
  ls) d="$(p "\${args[2]}")"; rel="\${args[2]#s3://}"; bucket="\${rel%%/*}"; [ -d "$d" ] || exit 0
      (cd "$FAKE_S3/$bucket" && find "\${rel#*/}" -type f -printf '2026-10-21 03:17:00 %s %p\\n' | sed 's#//#/#') ;;
  *) exit 2 ;;
esac`);
  // "Encryption": refuses without a passphrase on fd 3, marks and wraps.
  stub(bin, 'gpg', `echo "gpg $*" >> "$CALLS"
pass=$(cat <&3)
[ "$pass" = "$EXPECT_PASS" ] || { echo "bad passphrase" >&2; exit 2; }
out=""; mode=""; inp=""
while [ $# -gt 0 ]; do case "$1" in
  -o) out="$2"; shift ;; --symmetric) mode=enc ;; --decrypt) mode=dec ;;
  --cipher-algo|--passphrase-fd|--pinentry-mode) shift ;; -*) ;; *) inp="$1" ;; esac; shift; done
[ "$out" = - ] && out=""
run() { if [ "$mode" = enc ]; then echo "${MARK}"; base64 -w0 "$inp"; echo; else
  [ "$(head -n1 "$inp")" = "${MARK}" ] || exit 2; tail -n +2 "$inp" | base64 -d; fi; }
if [ -n "$out" ]; then run > "$out"; else run; fi`);
  stub(bin, 'logger', 'echo "logger $*" >> "$CALLS"');
  stub(bin, 'curl', 'echo "curl $*" >> "$CALLS"');
  stub(bin, 'mysqlbinlog', 'echo "mysqlbinlog $*" >> "$CALLS"');

  const env = (extra = '') => {
    const file = path.join(dir, 'offsite.env');
    write(file, [
      `MAHAD_OFFSITE_BUCKET=mahad-backups`,
      `MAHAD_OFFSITE_ENDPOINT=https://acct.r2.example`,
      `MAHAD_OFFSITE_ACCESS_KEY_ID=key-id`,
      `MAHAD_OFFSITE_SECRET_ACCESS_KEY=key-secret`,
      `MAHAD_OFFSITE_PREFIX=mahad`,
      `MAHAD_OFFSITE_PASSPHRASE='${PASSPHRASE}'`,
      `MAHAD_OFFSITE_STATE_DIR=${path.join(dir, 'state')}`,
      `MAHAD_OFFSITE_LOG=${path.join(dir, 'offsite.log')}`,
      `MAHAD_OFFSITE_API_DIR=${path.join(dir, 'api')}`,
      extra,
    ].join('\n'), 0o600);
    return file;
  };

  const run = (script, args, extraEnv = {}) => {
    const result = spawnSync('bash', [script, ...args], {
      encoding: 'utf8',
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        HOME: dir,
        TMPDIR: dir,
        TZ: 'UTC',
        CALLS: path.join(dir, 'calls.log'),
        FAKE_S3: bucket,
        EXPECT_PASS: PASSPHRASE,
        MAHAD_OFFSITE_ENV_FILE: path.join(dir, 'offsite.env'),
        MAHAD_OFFSITE_TOOL: 'rclone',
        ...extraEnv,
      },
    });
    const calls = fs.existsSync(path.join(dir, 'calls.log')) ? fs.readFileSync(path.join(dir, 'calls.log'), 'utf8') : '';
    fs.rmSync(path.join(dir, 'calls.log'), { force: true });
    return { status: result.status, out: result.stdout + result.stderr, calls };
  };

  const objects = () => {
    const found = [];
    const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else found.push(path.relative(bucket, f));
    } };
    walk(bucket);
    return found.sort();
  };
  const putObject = (key, body = 'x') => write(path.join(bucket, 'mahad-backups', 'mahad', key), body);
  const encrypted = text => `${MARK}\n${Buffer.from(text).toString('base64')}\n`;
  const gz = text => require('node:zlib').gzipSync(Buffer.from(text));

  return { dir, bin, bucket, env, run, objects, putObject, encrypted, gz, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const stamp = (daysAgo, hh = '03', mm = '17') => {
  const d = new Date(Date.now() - daysAgo * 86400000);
  return `${d.toISOString().slice(0, 10).replaceAll('-', '')}_${hh}${mm}00`;
};

test('with no settings file every command is off: exit 0, nothing called', { skip }, () => {
  const s = sandbox();
  try {
    for (const cmd of ['push-dump', 'ship-binlogs', 'sync-uploads', 'prune', 'rehearse']) {
      const r = s.run(OFFSITE, [cmd, '/nonexistent']);
      assert.equal(r.status, 0, `${cmd}: ${r.out}`);
      assert.equal(r.out, '', `${cmd} prints nothing for cron to mail`);
      assert.equal(r.calls, '', `${cmd} calls nothing`);
    }
    assert.match(s.run(OFFSITE, ['status']).out, /OFF: .*does not exist/);
  } finally { s.done(); }
});

test('a settings file others can read is refused, loudly', { skip }, () => {
  const s = sandbox();
  try {
    fs.chmodSync(s.env(), 0o644);
    const r = s.run(OFFSITE, ['prune']);
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, /refusing .* chmod 600/);
    assert.match(r.calls, /logger -p user.err -t mahad-offsite ALERT/);
    assert.doesNotMatch(r.calls, /rclone/);
  } finally { s.done(); }
});

test('push-dump uploads an encrypted copy and checks its size in the bucket', { skip }, () => {
  const s = sandbox();
  try {
    s.env();
    const dump = path.join(s.dir, `mahadnafsy_db_${stamp(0)}.sql.gz`);
    fs.writeFileSync(dump, s.gz('CREATE TABLE clients (phone varchar(20));\nINSERT INTO clients VALUES ("01001234567");\n'));
    const r = s.run(OFFSITE, ['push-dump', dump]);
    assert.equal(r.status, 0, r.out);
    const key = `mahad-backups/mahad/db/${path.basename(dump)}.gpg`;
    assert.deepEqual(s.objects(), [key]);
    const uploaded = fs.readFileSync(path.join(s.bucket, key), 'utf8');
    assert.ok(uploaded.startsWith(MARK), 'the object in the bucket is the encrypted form');
    assert.ok(!uploaded.includes('01001234567') && !fs.readFileSync(path.join(s.bucket, key)).equals(fs.readFileSync(dump)));
    assert.match(r.calls, /gpg .*--symmetric --cipher-algo AES256/);
    assert.match(r.calls, /rclone lsf/, 'the bucket is asked for the size');
    assert.doesNotMatch(r.calls, new RegExp(PASSPHRASE), 'the passphrase never appears on a command line');
    assert.doesNotMatch(r.calls, /key-secret/, 'nor does the bucket secret');
    assert.match(s.run(OFFSITE, ['status']).out, /push-dump\s*: ok .*db\/mahadnafsy_db_/);
    // No plaintext or encrypted leftovers in the temporary area.
    assert.deepEqual(fs.readdirSync(s.dir).filter(n => n.startsWith('mahad-offsite.')), []);
  } finally { s.done(); }
});

test('the aws CLI works as the transport too', { skip }, () => {
  const s = sandbox();
  try {
    s.env();
    const dump = path.join(s.dir, `mahadnafsy_db_${stamp(0)}.sql.gz`);
    fs.writeFileSync(dump, s.gz('dump'));
    const r = s.run(OFFSITE, ['push-dump', dump], { MAHAD_OFFSITE_TOOL: 'aws' });
    assert.equal(r.status, 0, r.out);
    assert.match(r.calls, /aws --endpoint-url https:\/\/acct\.r2\.example s3 cp/);
    assert.deepEqual(s.objects(), [`mahad-backups/mahad/db/${path.basename(dump)}.gpg`]);
  } finally { s.done(); }
});

test('a failed upload is alerted and exits non-zero; no passphrase means nothing is sent', { skip }, () => {
  const s = sandbox();
  try {
    s.env('ALERT_WEBHOOK_URL=https://hooks.example/x');
    const dump = path.join(s.dir, `mahadnafsy_db_${stamp(0)}.sql.gz`);
    fs.writeFileSync(dump, s.gz('dump'));
    const r = s.run(OFFSITE, ['push-dump', dump], { RCLONE_FAIL: '1' });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /ALERT mahad-offsite: push-dump FAILED: uploading db\/.* failed/);
    assert.match(r.calls, /logger -p user.err -t mahad-offsite ALERT push-dump FAILED/);
    assert.match(r.calls, /curl .*hooks\.example/, 'the incident webhook hears it too');
    assert.match(s.run(OFFSITE, ['status']).out, /push-dump\s*: FAILED/);

    s.env('MAHAD_OFFSITE_PASSPHRASE=');
    const clear = s.run(OFFSITE, ['push-dump', dump]);
    assert.equal(clear.status, 1);
    assert.match(clear.out, /nothing is ever shipped in clear/);
    assert.deepEqual(s.objects(), []);
  } finally { s.done(); }
});

// The hourly backup script hands its verified dump to mahad-offsite when the
// settings file exists, and the old MAHAD_BACKUP_REMOTE path is untouched.
function backupRun(s, { offsiteEnv = true, logBin = '0', rcloneFail = false } = {}) {
  stub(s.bin, 'mysqldump', `echo "mysqldump $*" >> "$CALLS"; for i in $(seq 1 60); do echo "CREATE TABLE t$i (id int);"; done`);
  stub(s.bin, 'mysql', `echo "mysql $*" >> "$CALLS"; echo ${logBin}`);
  if (offsiteEnv) s.env(); else fs.rmSync(path.join(s.dir, 'offsite.env'), { force: true });
  return s.run(BACKUP, [], {
    MAHAD_BACKUP_ENV_FILE: path.join(s.dir, 'none.env'),
    MAHAD_BACKUP_DIR: path.join(s.dir, 'backups'),
    MAHAD_BACKUP_LOG: path.join(s.dir, 'backup.log'),
    MAHAD_BACKUP_MIN_BYTES: '1',
    MAHAD_OFFSITE_BIN: OFFSITE,
    ...(rcloneFail ? { RCLONE_FAIL: '1' } : {}),
  });
}

test('the hourly backup ships through mahad-offsite when it is configured', { skip }, () => {
  const s = sandbox();
  try {
    const r = backupRun(s);
    assert.equal(r.status, 0, r.out + fs.readFileSync(path.join(s.dir, 'backup.log'), 'utf8'));
    const [object] = s.objects();
    assert.match(object, /^mahad-backups\/mahad\/db\/mahadnafsy_db_\d{8}_\d{6}\.sql\.gz\.gpg$/);
    assert.match(fs.readFileSync(path.join(s.dir, 'backup.log'), 'utf8'), /off-site ok via mahad-offsite/);
    assert.doesNotMatch(r.calls, /--master-data/, 'no binlog position asked for while binary logging is off');
  } finally { s.done(); }
});

test('the hourly backup records the binlog position once binary logging is on', { skip }, () => {
  const s = sandbox();
  try {
    const r = backupRun(s, { logBin: '1' });
    assert.equal(r.status, 0, r.out);
    assert.match(r.calls, /mysqldump .*--master-data=2 mahadnafsy_db/);
  } finally { s.done(); }
});

test('the hourly backup exits 3 with an ALERT when the off-site copy fails, or nothing is configured', { skip }, () => {
  const s = sandbox();
  try {
    const failed = backupRun(s, { rcloneFail: true });
    assert.equal(failed.status, 3, failed.out);
    assert.match(failed.out, /OFF-SITE BACKUP FAILED: mahad-offsite push-dump failed/);
    assert.equal(fs.readdirSync(path.join(s.dir, 'backups')).filter(n => n.endsWith('.sql.gz')).length, 1, 'the local dump is kept');

    const none = backupRun(s, { offsiteEnv: false });
    assert.equal(none.status, 3, none.out);
    assert.match(none.out, /no off-site destination: neither .*offsite\.env nor MAHAD_BACKUP_REMOTE is set/);
  } finally { s.done(); }
});

// ── binary logs ─────────────────────────────────────────────────────────────
function binlogServer(s, { active = 'mariadb-bin.000003', logs = ['mariadb-bin.000001', 'mariadb-bin.000002', 'mariadb-bin.000003'], on = true } = {}) {
  const dir = path.join(s.dir, 'mysql-log');
  for (const name of logs) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) write(file, `binlog ${name}`);
  }
  write(path.join(s.dir, 'master'), on ? `${active}\t${400 + logs.length}\t\t\n` : '');
  stub(s.bin, 'mysql', `echo "mysql $*" >> "$CALLS"
case "$*" in
  *"SHOW MASTER STATUS"*) cat "${path.join(s.dir, 'master')}" ;;
  *"SHOW BINARY LOGS"*) for f in ${logs.join(' ')}; do printf '%s\\t100\\n' "$f"; done ;;
  *log_bin_basename*) echo "${dir}/mariadb-bin" ;;
  *FLUSH*) exit 0 ;;
esac`);
}

test('ship-binlogs is idle while binary logging is off', { skip }, () => {
  const s = sandbox();
  try {
    s.env();
    binlogServer(s, { on: false });
    const r = s.run(OFFSITE, ['ship-binlogs']);
    assert.equal(r.status, 0, r.out);
    assert.equal(r.out, '');
    assert.doesNotMatch(r.calls, /rclone|FLUSH/);
    assert.match(s.run(OFFSITE, ['status']).out, /ship-binlogs\s*: off .*binary logging is off/);
  } finally { s.done(); }
});

test('ship-binlogs skips the active log and never re-uploads a shipped one', { skip }, () => {
  const s = sandbox();
  try {
    s.env();
    binlogServer(s);
    const first = s.run(OFFSITE, ['ship-binlogs']);
    assert.equal(first.status, 0, first.out);
    assert.match(first.calls, /mysql .*FLUSH BINARY LOGS/);
    const names = s.objects().map(o => path.basename(o));
    assert.deepEqual(names, ['mariadb-bin.000001.gpg', 'mariadb-bin.000002.gpg'], 'the active 000003 stays home');
    assert.ok(s.objects().every(o => /^mahad-backups\/mahad\/binlog\/\d{4}-\d{2}-\d{2}\//.test(o)));
    assert.ok(fs.readFileSync(path.join(s.bucket, s.objects()[0]), 'utf8').startsWith(MARK));

    // Nothing written since: no flush, no upload.
    const again = s.run(OFFSITE, ['ship-binlogs']);
    assert.equal(again.status, 0, again.out);
    assert.doesNotMatch(again.calls, /FLUSH|rclone copyto/);

    // 000003 closes, 000004 is active: only 000003 goes.
    binlogServer(s, { active: 'mariadb-bin.000004', logs: ['mariadb-bin.000001', 'mariadb-bin.000002', 'mariadb-bin.000003', 'mariadb-bin.000004'] });
    const third = s.run(OFFSITE, ['ship-binlogs']);
    assert.equal(third.status, 0, third.out);
    assert.equal((third.calls.match(/rclone copyto/g) || []).length, 1, third.calls);
    assert.match(third.calls, /mariadb-bin\.000003\.gpg/);
    assert.equal(s.objects().length, 3);
  } finally { s.done(); }
});

test('a binlog that cannot be shipped is alerted and is tried again next time', { skip }, () => {
  const s = sandbox();
  try {
    s.env();
    binlogServer(s);
    const r = s.run(OFFSITE, ['ship-binlogs'], { RCLONE_FAIL: '1' });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /ALERT mahad-offsite: ship-binlogs FAILED/);
    const retry = s.run(OFFSITE, ['ship-binlogs']);
    assert.equal(retry.status, 0, retry.out);
    assert.equal(s.objects().length, 2);
  } finally { s.done(); }
});

// ── uploads ─────────────────────────────────────────────────────────────────
test('sync-uploads sends new and changed files encrypted, once, and never deletes off-site', { skip }, () => {
  const s = sandbox();
  try {
    s.env();
    const uploads = path.join(s.dir, 'api', 'uploads');
    write(path.join(uploads, 'videos', 't1', 'lecture.mp4'), 'video bytes');
    write(path.join(uploads, 'branding', 't1', 'logo.png'), 'png');
    write(path.join(uploads, 'videos', '.tmp', 'half.mp4'), 'in flight');
    const first = s.run(OFFSITE, ['sync-uploads']);
    assert.equal(first.status, 0, first.out);
    const prefix = `mahad-backups/mahad/uploads${uploads}/`;
    assert.deepEqual(s.objects(), [`${prefix}branding/t1/logo.png.gpg`, `${prefix}videos/t1/lecture.mp4.gpg`]);
    assert.ok(fs.readFileSync(path.join(s.bucket, `${prefix}videos/t1/lecture.mp4.gpg`), 'utf8').startsWith(MARK));

    const again = s.run(OFFSITE, ['sync-uploads']);
    assert.match(again.out, /0 new or changed/);
    assert.doesNotMatch(again.calls, /rclone rcat/);

    write(path.join(uploads, 'videos', 't1', 'lecture.mp4'), 'a longer re-encoded video');
    fs.rmSync(path.join(uploads, 'branding', 't1', 'logo.png'));
    const changed = s.run(OFFSITE, ['sync-uploads']);
    assert.equal((changed.calls.match(/rclone rcat/g) || []).length, 1);
    assert.equal(s.objects().length, 2, 'the deleted logo is still off-site');

    // And back: every file decrypted at its original path under the target.
    const back = path.join(s.dir, 'restored');
    const restored = s.run(OFFSITE, ['fetch-uploads', back]);
    assert.equal(restored.status, 0, restored.out);
    assert.equal(fs.readFileSync(path.join(back, uploads, 'videos', 't1', 'lecture.mp4'), 'utf8'), 'a longer re-encoded video');
    assert.equal(fs.readFileSync(path.join(back, uploads, 'branding', 't1', 'logo.png'), 'utf8'), 'png');
  } finally { s.done(); }
});

// ── retention ───────────────────────────────────────────────────────────────
test('prune keeps 7 days hourly, then one a day to 35 days, then one a month', { skip }, () => {
  const s = sandbox();
  try {
    s.env();
    const name = (days, hh) => `db/mahadnafsy_db_${stamp(days, hh)}.sql.gz.gpg`;
    const keep = [name(1, '05'), name(1, '06'), name(6, '23'), name(10, '01'), name(30, '02')];
    const drop = [name(10, '07'), name(30, '09'), name(400, '03')];
    for (const key of [...keep, ...drop]) s.putObject(key);
    s.putObject('db/notes.txt');
    s.putObject(`binlog/${new Date(Date.now() - 50 * 86400000).toISOString().slice(0, 10)}/mariadb-bin.000001.gpg`);
    s.putObject(`binlog/${new Date().toISOString().slice(0, 10)}/mariadb-bin.000009.gpg`);
    const r = s.run(OFFSITE, ['prune']);
    assert.equal(r.status, 0, r.out);
    const left = s.objects().map(o => o.replace('mahad-backups/mahad/', ''));
    for (const key of keep) assert.ok(left.includes(key), `${key} kept`);
    for (const key of drop) assert.ok(!left.includes(key), `${key} removed`);
    assert.ok(left.includes('db/notes.txt'), 'a name it does not understand is never deleted');
    assert.equal(left.filter(k => k.startsWith('binlog/')).length, 1, 'the 50-day-old binlog is removed');

    const dry = s.run(OFFSITE, ['prune', '--dry-run']);
    assert.equal(dry.status, 0);
    assert.doesNotMatch(dry.calls, /deletefile/);
  } finally { s.done(); }
});

// ── restore rehearsal from the off-site copy ────────────────────────────────
test('rehearse restores the newest off-site dump through the existing verification', { skip }, () => {
  const s = sandbox();
  try {
    const verify = path.join(s.dir, 'verify.sh');
    write(verify, `#!/usr/bin/env bash
ls "$MAHAD_BACKUP_DIR" > "${path.join(s.dir, 'seen')}"
zcat "$MAHAD_BACKUP_DIR"/*.sql.gz >> "${path.join(s.dir, 'seen')}"
exit "\${VERIFY_RC:-0}"`, 0o755);
    s.env(`MAHAD_OFFSITE_VERIFY_CMD=${verify}`);
    const older = `mahadnafsy_db_${stamp(2)}.sql.gz`;
    const newest = `mahadnafsy_db_${stamp(0, '01')}.sql.gz`;
    const encryptedGz = text => `${MARK}\n${s.gz(text).toString('base64')}\n`;
    s.putObject(`db/${older}.gpg`, encryptedGz('older dump'));
    s.putObject(`db/${newest}.gpg`, encryptedGz('newest dump'));
    s.putObject('db/zzz-not-a-dump.gpg', 'junk');

    // Opt-in: the monthly cron line does nothing without MAHAD_OFFSITE_REHEARSAL=1.
    const off = s.run(OFFSITE, ['rehearse', '--scheduled']);
    assert.equal(off.status, 0);
    assert.doesNotMatch(off.calls, /rclone/);

    const r = s.run(OFFSITE, ['rehearse']);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, new RegExp(`newest off-site dump is ${newest}\\.gpg`));
    assert.match(r.out, /rehearsal PASS/);
    assert.equal(fs.readFileSync(path.join(s.dir, 'seen'), 'utf8'), `${newest}\nnewest dump`);
    assert.deepEqual(fs.readdirSync(s.dir).filter(n => n.startsWith('mahad-offsite.')), [], 'the decrypted dump is removed');

    const failed = s.run(OFFSITE, ['rehearse'], { VERIFY_RC: '1' });
    assert.equal(failed.status, 1);
    assert.match(failed.out, /ALERT mahad-offsite: rehearse FAILED: the off-site dump .* did not pass the restore check/);
  } finally { s.done(); }
});

test('fetch-pitr pairs the dump before the moment with the binlogs from its position', { skip }, () => {
  const s = sandbox();
  try {
    s.env();
    const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const compact = day.replaceAll('-', '');
    const dumpText = "-- MariaDB dump\n-- CHANGE MASTER TO MASTER_LOG_FILE='mariadb-bin.000007', MASTER_LOG_POS=1234;\nCREATE TABLE t (id int);\n";
    const enc = text => `${MARK}\n${s.gz(text).toString('base64')}\n`;
    s.putObject(`db/mahadnafsy_db_${compact}_090000.sql.gz.gpg`, enc(dumpText));
    s.putObject(`db/mahadnafsy_db_${compact}_110000.sql.gz.gpg`, enc('after the moment'));
    for (const n of ['000006', '000007', '000008']) s.putObject(`binlog/${day}/mariadb-bin.${n}.gpg`, s.encrypted(`log ${n}`));
    const out = path.join(s.dir, 'pitr');
    const r = s.run(OFFSITE, ['fetch-pitr', `${day} 10:30:00`, out]);
    assert.equal(r.status, 0, r.out);
    assert.ok(fs.existsSync(path.join(out, `mahadnafsy_db_${compact}_090000.sql.gz`)), 'the 09:00 dump, not the 11:00 one');
    assert.deepEqual(fs.readdirSync(path.join(out, 'binlogs')), ['mariadb-bin.000007', 'mariadb-bin.000008']);
    assert.match(r.calls, new RegExp(`mysqlbinlog --start-position=1234 --stop-datetime=${day} 10:30:00 .*mariadb-bin\\.000007 .*mariadb-bin\\.000008`));
    const commands = fs.readFileSync(path.join(out, 'RESTORE_COMMANDS.txt'), 'utf8');
    assert.match(commands, /CREATE DATABASE mahad_pitr/);
    assert.match(commands, /mysqlbinlog --start-position=1234 --stop-datetime=/);
  } finally { s.done(); }
});

test('the deploy installs the off-site pieces but never switches binary logging on', () => {
  const deploy = fs.readFileSync(path.join(repoRoot, 'deploy-release.sh'), 'utf8');
  const releaseAll = fs.readFileSync(path.join(repoRoot, 'deploy', 'release-all.sh'), 'utf8');
  assert.match(deploy, /install -m 0755 \/staging\/mahad-offsite\.sh \/usr\/local\/bin\/mahad-offsite/);
  assert.match(deploy, /install -m 0644 \/staging\/mahad-offsite \/etc\/cron\.d\/mahad-offsite/);
  assert.match(deploy, /NOTE: MariaDB binary logs are OFF/);
  assert.doesNotMatch(deploy, /mariadb\.conf\.d|systemctl restart mariadb/, 'binary logging needs a person and a restart');
  for (const f of ['deploy/mahad-offsite.sh', 'deploy/cron/mahad-offsite', 'deploy/mariadb/60-mahad-binlog.cnf']) {
    assert.ok(releaseAll.includes(`"${f}"`), `${f} is uploaded with the release`);
  }
  const cron = fs.readFileSync(path.join(repoRoot, 'deploy', 'cron', 'mahad-offsite'), 'utf8');
  assert.doesNotMatch(cron.split('\n').filter(l => !l.startsWith('#')).join('\n'), /%/, 'cron reads % as a newline');
  assert.match(cron, /^\*\/15 \* \* \* \* root \/usr\/local\/bin\/mahad-offsite ship-binlogs/m);
  assert.match(cron, /rehearse --scheduled/);
});
