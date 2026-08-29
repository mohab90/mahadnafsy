'use strict';

// One authoritative daily backup path. It streams mysqldump through Node gzip,
// never puts the password or database values in a shell command, writes
// atomically and records a SHA-256 sidecar for later restore verification.
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { createGzip } = require('zlib');
const logger = require('./logger');

// Where a backup is written.
//
// This used to default to cwd/db-backups. On the server cwd is the deployment
// directory, so a backup written there is replaced by the next release — the
// four retired deployments on the box each hold an empty db-backups folder,
// which is what that default produces. A backup that a deploy can delete is
// not a backup.
//
// The default is now outside the deployment tree on Linux, and stays relative
// on Windows where /var does not exist. DB_BACKUP_DIR still overrides both,
// and the scheduled nightly dump run from system cron is unaffected either
// way — it writes to /var/backups/mahad-db and is the copy actually relied on.
const DEFAULT_DIR = process.platform === 'win32'
  ? path.join(process.cwd(), 'db-backups')
  : '/var/backups/mahad-db-app';
const DIR = path.resolve(process.env.DB_BACKUP_DIR || DEFAULT_DIR);
const KEEP = Math.max(1, Number(process.env.DB_BACKUP_KEEP || 14));
const ENABLED = process.env.DB_BACKUP_ENABLED === '1';
const today = () => new Date().toISOString().slice(0, 10);

// Does this mysqldump understand --set-gtid-purged?
//
// It is a MySQL option. MariaDB's mysqldump does not merely ignore it, it
// refuses to start: "unknown variable 'set-gtid-purged=OFF'", exit 7. This
// server runs MariaDB, so every in-app backup has failed since the flag was
// added — 96 times, into an empty directory, while the separate cron dump kept
// working and hid it.
//
// Asking the binary what it supports is the one check that stays right when
// the same code runs against either flavour.
let gtidSupport = null;
function supportsGtidPurged() {
  if (gtidSupport !== null) return gtidSupport;
  try {
    const probe = spawnSync(process.env.MYSQLDUMP_PATH || 'mysqldump', ['--help'], {
      encoding: 'utf8', timeout: 10000, windowsHide: true,
    });
    gtidSupport = /set-gtid-purged/.test(String(probe.stdout || '') + String(probe.stderr || ''));
  } catch {
    // Probe failed for an unrelated reason. Leave the flag off: its absence
    // costs a GTID header on MySQL, its presence costs the whole backup here.
    gtidSupport = false;
  }
  return gtidSupport;
}

function dumpProcess() {
  const {
    DB_HOST = '127.0.0.1', DB_PORT = '3306', DB_USER, DB_PASSWORD, DB_NAME,
  } = process.env;
  if (!DB_USER || !DB_NAME) throw new Error('missing DB credentials');
  const args = [
    `--host=${DB_HOST}`, `--port=${DB_PORT}`, `--user=${DB_USER}`,
    '--single-transaction', '--quick', '--routines', '--triggers', '--events',
    '--no-tablespaces',
    ...(supportsGtidPurged() ? ['--set-gtid-purged=OFF'] : []),
    DB_NAME,
  ];
  const child = spawn(process.env.MYSQLDUMP_PATH || 'mysqldump', args, {
    env: { ...process.env, MYSQL_PWD: DB_PASSWORD || '' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  // Buffered rather than decoded per chunk. mysqldump's diagnostics are
  // usually ASCII, but a path or table name in them need not be, and a
  // mangled error message is the one thing that must stay readable.
  const stderrParts = [];
  child.stderr.on('data', chunk => stderrParts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  const completed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => code === 0
      ? resolve()
      : reject(new Error(`mysqldump exited ${code}: ${Buffer.concat(stderrParts).toString('utf8').slice(-1000)}`)));
  });
  return { child, completed };
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.once('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.once('end', () => resolve(hash.digest('hex')));
  });
}

async function runBackup() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const file = path.join(DIR, `${process.env.DB_NAME || 'db'}-${today()}.sql.gz`);
  const partial = `${file}.${process.pid}.partial`;
  if (fs.existsSync(file)) return false;
  try {
    const { child, completed } = dumpProcess();
    await Promise.all([
      pipeline(child.stdout, createGzip({ level: 6 }), fs.createWriteStream(partial, { flags: 'wx', mode: 0o600 })),
      completed,
    ]);
    const size = fs.statSync(partial).size;
    if (size < 1024) throw new Error(`dump suspiciously small (${size} bytes)`);
    const checksum = await sha256File(partial);
    fs.renameSync(partial, file);
    fs.writeFileSync(`${file}.sha256`, `${checksum}  ${path.basename(file)}\n`, { flag: 'wx', mode: 0o600 });

    const files = fs.readdirSync(DIR).filter(name => name.endsWith('.sql.gz')).sort();
    while (files.length > KEEP) {
      const old = files.shift();
      try { fs.unlinkSync(path.join(DIR, old)); } catch (_) {}
      try { fs.unlinkSync(path.join(DIR, `${old}.sha256`)); } catch (_) {}
    }
    logger.info(`[dbBackup] wrote ${path.basename(file)} (${(size / 1048576).toFixed(1)}MB); keeping last ${KEEP}`);
    return true;
  } catch (error) {
    try { fs.unlinkSync(partial); } catch (_) {}
    logger.error('[dbBackup] dump failed:', error.message);
    return false;
  }
}

function scheduleDbBackup() {
  if (!ENABLED) {
    logger.info('[dbBackup] application backup disabled; managed PITR remains the production authority');
    return null;
  }
  const first = setTimeout(() => runBackup().catch(() => {}), 2 * 60 * 1000);
  const interval = setInterval(() => runBackup().catch(() => {}), 60 * 60 * 1000);
  if (first.unref) first.unref();
  if (interval.unref) interval.unref();
  logger.info(`[dbBackup] scheduled daily backups → ${DIR} (keep ${KEEP})`);
  return interval;
}

module.exports = { runBackup, scheduleDbBackup, DIR };
