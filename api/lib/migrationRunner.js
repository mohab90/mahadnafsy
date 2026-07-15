'use strict';
// ── Numbered SQL migration runner ────────────────────────────────────────────
// The forward path off the fragile boot-time DDL in startupTasks.js. Applies
// api/migrations/NNN_*.sql in order, exactly once each, tracked in the
// schema_migrations table. Historical migrations (<= BASELINE_THROUGH) are
// already reflected in every existing DB (built by startupTasks.js + past manual
// runs), so on first run they're recorded as a baseline WITHOUT re-executing —
// only genuinely new migrations (034+) ever run. New migrations must be written
// idempotently (IF [NOT] EXISTS guards): MariaDB auto-commits DDL, so a failed
// multi-statement migration can't fully roll back — it's simply retried next boot.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const BASELINE_THROUGH = 33; // 001..033 predate the runner; already in the live schema.

function migrationNumber(file) {
  const m = file.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : NaN;
}

// Migrations here are plain DDL/DML — no DELIMITER / stored-proc blocks — so a
// semicolon split (after stripping line comments) is safe.
function splitStatements(sql) {
  const noComments = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  return noComments.split(';').map(s => s.trim()).filter(Boolean);
}

function checksumOf(sql) {
  return crypto.createHash('sha256').update(sql).digest('hex').slice(0, 16);
}

async function runMigrations(pool) {
  const prevMigrationFlag = process.env.MAHAD_SCHEMA_MIGRATION_ACTIVE;
  process.env.MAHAD_SCHEMA_MIGRATION_ACTIVE = '1';
  const restoreMigrationFlag = () => {
    if (prevMigrationFlag == null) delete process.env.MAHAD_SCHEMA_MIGRATION_ACTIVE;
    else process.env.MAHAD_SCHEMA_MIGRATION_ACTIVE = prevMigrationFlag;
  };
  try {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      checksum VARCHAR(32),
      status VARCHAR(16) DEFAULT 'applied',
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } catch (e) {
    logger.error('[migrate] cannot ensure schema_migrations:', e.message);
    restoreMigrationFlag();
    return { baseline: 0, applied: 0, failed: 0 };
  }

  let files;
  try {
    files = fs.readdirSync(MIGRATIONS_DIR).filter(f => /^\d+.*\.sql$/.test(f)).sort();
  } catch (e) {
    logger.warn('[migrate] migrations dir unreadable:', e.message);
    restoreMigrationFlag();
    return { baseline: 0, applied: 0, failed: 0 };
  }

  let rows;
  try {
    [rows] = await pool.query('SELECT version FROM schema_migrations');
  } catch (e) {
    logger.error('[migrate] cannot read schema_migrations:', e.message);
    restoreMigrationFlag();
    return { baseline: 0, applied: 0, failed: 1 };
  }
  const applied = new Set(rows.map(r => r.version));

  // First run against an existing DB → baseline the historical migrations.
  let baseline = 0;
  if (applied.size === 0) {
    for (const f of files) {
      if (migrationNumber(f) <= BASELINE_THROUGH) {
        const sum = checksumOf(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
        await pool.query(
          'INSERT IGNORE INTO schema_migrations (version, checksum, status) VALUES (?,?,?)',
          [f, sum, 'baseline']
        ).catch(() => {});
        applied.add(f);
        baseline++;
      }
    }
    if (baseline) logger.info(`[migrate] baselined ${baseline} historical migration(s) (<= ${BASELINE_THROUGH})`);
  }

  let ranCount = 0, failed = 0;
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    const statements = splitStatements(sql);
    try {
      for (const stmt of statements) await pool.query(stmt);
      await pool.query(
        `INSERT INTO schema_migrations (version, checksum, status) VALUES (?,?,'applied')
         ON DUPLICATE KEY UPDATE checksum=VALUES(checksum), status='applied', applied_at=CURRENT_TIMESTAMP`,
        [f, checksumOf(sql)]
      );
      logger.info(`[migrate] applied ${f} (${statements.length} statements)`);
      ranCount++;
    } catch (e) {
      failed++;
      logger.error(`[migrate] FAILED ${f}: ${e.message} — will retry next boot`);
    }
  }
  if (ranCount === 0 && failed === 0) logger.info('[migrate] schema up to date');
  restoreMigrationFlag();
  return { baseline, applied: ranCount, failed };
  } finally {
    restoreMigrationFlag();
  }
}

module.exports = { runMigrations, BASELINE_THROUGH };
