'use strict';

// One authoritative daily backup path. It streams mysqldump through Node gzip,
// never puts the password or database values in a shell command, writes
// atomically and records a SHA-256 sidecar for later restore verification.
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { createGzip } = require('zlib');
const logger = require('./logger');

const DIR = path.resolve(process.env.DB_BACKUP_DIR || path.join(process.cwd(), 'db-backups'));
const KEEP = Math.max(1, Number(process.env.DB_BACKUP_KEEP || 14));
const ENABLED = process.env.DB_BACKUP_ENABLED === '1';
const today = () => new Date().toISOString().slice(0, 10);

function dumpProcess() {
  const {
    DB_HOST = '127.0.0.1', DB_PORT = '3306', DB_USER, DB_PASSWORD, DB_NAME,
  } = process.env;
  if (!DB_USER || !DB_NAME) throw new Error('missing DB credentials');
  const args = [
    `--host=${DB_HOST}`, `--port=${DB_PORT}`, `--user=${DB_USER}`,
    '--single-transaction', '--quick', '--routines', '--triggers', '--events',
    '--no-tablespaces', '--set-gtid-purged=OFF', DB_NAME,
  ];
  const child = spawn(process.env.MYSQLDUMP_PATH || 'mysqldump', args, {
    env: { ...process.env, MYSQL_PWD: DB_PASSWORD || '' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const completed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => code === 0
      ? resolve()
      : reject(new Error(`mysqldump exited ${code}: ${stderr.slice(-1000)}`)));
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
