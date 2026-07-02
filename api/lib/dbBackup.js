'use strict';
// Automated daily DB backup (VPS-independent — runs from the always-on app
// process, same pattern as the other self-scheduled workers). Writes a gzipped
// mysqldump to a directory OUTSIDE the app tree (so redeploys never wipe it) and
// rotates to the last N days. Enabled only in production; opt out with
// DB_BACKUP_ENABLED=0. Tunables: DB_BACKUP_DIR, DB_BACKUP_KEEP, MYSQLDUMP_PATH.
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const HOME = process.env.HOME || '/home/u176948796';
const DIR = process.env.DB_BACKUP_DIR || path.join(HOME, 'db-backups');
const KEEP = Math.max(1, Number(process.env.DB_BACKUP_KEEP || 14));
// Enable when explicitly flagged (DB_BACKUP_ENABLED=1) OR in production (unless
// turned off with =0). Explicit flag avoids flipping global NODE_ENV just for this.
const ENABLED = process.env.DB_BACKUP_ENABLED === '1'
  || (process.env.DB_BACKUP_ENABLED !== '0' && process.env.NODE_ENV === 'production');
const today = () => new Date().toISOString().slice(0, 10);

// Run one backup. No-ops if today's file already exists (so the hourly tick is
// idempotent). Returns true if a fresh dump was written.
function runBackup() {
  return new Promise((resolve) => {
    try {
      if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
      const file = path.join(DIR, `${process.env.DB_NAME || 'db'}-${today()}.sql.gz`);
      if (fs.existsSync(file)) return resolve(false);
      const { DB_HOST = '127.0.0.1', DB_PORT = '3306', DB_USER, DB_PASSWORD, DB_NAME } = process.env;
      if (!DB_USER || !DB_NAME) { logger.warn('[dbBackup] missing DB creds — skipping'); return resolve(false); }
      const dump = process.env.MYSQLDUMP_PATH || 'mysqldump';
      // Password passed via MYSQL_PWD (env), never on the command line.
      const cmd = `${dump} -h${DB_HOST} -P${DB_PORT} -u'${DB_USER}' --single-transaction --quick --routines --no-tablespaces '${DB_NAME}' | gzip > '${file}'`;
      exec(cmd, { env: { ...process.env, MYSQL_PWD: DB_PASSWORD || '' }, maxBuffer: 128 * 1024 * 1024, timeout: 10 * 60 * 1000, shell: '/bin/bash' }, (err) => {
        if (err) { logger.error('[dbBackup] dump failed:', err.message); try { fs.unlinkSync(file); } catch { /* ignore */ } return resolve(false); }
        let size = 0; try { size = fs.statSync(file).size; } catch { /* ignore */ }
        if (size < 1024) { logger.error('[dbBackup] dump suspiciously small — discarding'); try { fs.unlinkSync(file); } catch { /* ignore */ } return resolve(false); }
        // Rotate — keep the newest KEEP files.
        try {
          const files = fs.readdirSync(DIR).filter(f => f.endsWith('.sql.gz')).sort();
          while (files.length > KEEP) { const old = files.shift(); try { fs.unlinkSync(path.join(DIR, old)); } catch { /* ignore */ } }
        } catch { /* ignore */ }
        logger.info(`[dbBackup] wrote ${path.basename(file)} (${(size / 1048576).toFixed(1)}MB); keeping last ${KEEP}`);
        resolve(true);
      });
    } catch (e) { logger.error('[dbBackup]', e.message); resolve(false); }
  });
}

// Hourly tick (idempotent) → a fresh dump lands once per calendar day. First run
// ~2 min after boot so it never competes with startup. Unref'd, never blocks exit.
function scheduleDbBackup() {
  if (!ENABLED) { logger.info('[dbBackup] disabled (set NODE_ENV=production + DB_BACKUP_ENABLED!=0 to enable)'); return null; }
  setTimeout(() => runBackup().catch(() => {}), 2 * 60 * 1000);
  const iv = setInterval(() => runBackup().catch(() => {}), 60 * 60 * 1000);
  if (iv.unref) iv.unref();
  logger.info(`[dbBackup] scheduled daily backups → ${DIR} (keep ${KEEP})`);
  return iv;
}

module.exports = { runBackup, scheduleDbBackup, DIR };
