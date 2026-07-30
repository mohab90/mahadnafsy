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
const REFERENCE_SCHEMA = path.join(__dirname, '..', 'schema.sql');
const BASELINE_THROUGH = 33; // 001..033 predate the runner; already in the live schema.
const CORE_TABLES = ['courses', 'leads', 'payments', 'staff', 'subscribers'];
// These migrations only transform legacy rows. A database created from the
// current reference snapshot has no legacy rows, so compiling/replaying them is
// unnecessary and can be engine/collation dependent. Their checksums are still
// recorded; all structural migrations continue to execute normally.
const EMPTY_SNAPSHOT_DATA_BASELINES = new Set([
  '121_v25_lms_legacy_entitlement_backfill.sql',
  '124_v25_lms_progress_backfill.sql',
  '125_v25_lms_legacy_certificates_backfill.sql',
]);

function migrationNumber(file) {
  const m = file.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : NaN;
}

// Migrations here are plain DDL/DML — no DELIMITER / stored-proc blocks — so a
// semicolon split (after stripping line comments) is safe.
function splitStatements(sql) {
  const noComments = sql.split('\n').map((line) => {
    let quote = null;
    for (let i = 0; i < line.length - 1; i++) {
      const char = line[i];
      if (quote) {
        if (char === quote && line[i - 1] !== '\\') quote = null;
      } else if (char === "'" || char === '"' || char === '`') {
        quote = char;
      } else if (char === '-' && line[i + 1] === '-' && /\s|$/.test(line[i + 2] || '')) {
        return line.slice(0, i);
      }
    }
    return line;
  }).join('\n');
  return noComments.split(';').map(s => s.trim()).filter(Boolean);
}

function checksumOf(sql) {
  return crypto.createHash('sha256').update(sql).digest('hex').slice(0, 16);
}

function splitAlterActions(sql) {
  const actions = [];
  let start = 0, depth = 0, quote = null;
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    if (quote) {
      if (char === quote && sql[i - 1] !== '\\') quote = null;
    } else if (char === "'" || char === '"' || char === '`') {
      quote = char;
    } else if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
    } else if (char === ',' && depth === 0) {
      actions.push(sql.slice(start, i).trim());
      start = i + 1;
    }
  }
  actions.push(sql.slice(start).trim());
  return actions.filter(Boolean);
}

async function objectExists(pool, kind, table, name = null) {
  const definitions = {
    table: ['information_schema.tables', 'table_name'],
    column: ['information_schema.columns', 'column_name'],
    index: ['information_schema.statistics', 'index_name'],
    constraint: ['information_schema.table_constraints', 'constraint_name'],
  };
  const [source, field] = definitions[kind];
  const params = name == null ? [table] : [table, name];
  const [[row]] = await pool.query(
    `SELECT EXISTS(SELECT 1 FROM ${source}
      WHERE table_schema=DATABASE() AND table_name=?${name == null ? '' : ` AND ${field}=?`}) AS object_exists`,
    params
  );
  return Boolean(Number(row?.object_exists || 0));
}

async function prepareIdempotentStatement(pool, statement) {
  const standaloneDrop = statement.match(
    /^DROP\s+INDEX\s+IF\s+EXISTS\s+`?([A-Za-z0-9_$]+)`?\s+ON\s+`?([A-Za-z0-9_$]+)`?$/i
  );
  if (standaloneDrop) {
    if (!await objectExists(pool, 'index', standaloneDrop[2], standaloneDrop[1])) return null;
    return `DROP INDEX \`${standaloneDrop[1]}\` ON \`${standaloneDrop[2]}\``;
  }

  const standaloneCreate = statement.match(
    /^CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+`?([A-Za-z0-9_$]+)`?\s+ON\s+`?([A-Za-z0-9_$]+)`?([\s\S]+)$/i
  );
  if (standaloneCreate) {
    if (await objectExists(pool, 'index', standaloneCreate[3], standaloneCreate[2])) return null;
    return `CREATE ${standaloneCreate[1] || ''}INDEX \`${standaloneCreate[2]}\` ON \`${standaloneCreate[3]}\`${standaloneCreate[4]}`;
  }

  const alter = statement.match(
    /^ALTER\s+TABLE\s+(IF\s+EXISTS\s+)?`?([A-Za-z0-9_$]+)`?\s+([\s\S]+)$/i
  );
  if (!alter) return statement;
  const [, guardedTable, table, actionSql] = alter;
  if (guardedTable && !await objectExists(pool, 'table', table)) return null;

  const kept = [];
  for (const originalAction of splitAlterActions(actionSql)) {
    let action = originalAction;
    const addColumn = action.match(/^ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+`?([A-Za-z0-9_$]+)`?/i);
    const addIndex = action.match(/^ADD\s+(?:UNIQUE\s+)?(?:INDEX|KEY)\s+IF\s+NOT\s+EXISTS\s+`?([A-Za-z0-9_$]+)`?/i);
    const addConstraint = action.match(/^ADD\s+CONSTRAINT\s+IF\s+NOT\s+EXISTS\s+`?([A-Za-z0-9_$]+)`?/i);
    const dropIndex = action.match(/^DROP\s+(?:INDEX|KEY)\s+IF\s+EXISTS\s+`?([A-Za-z0-9_$]+)`?/i);
    if (addColumn) {
      if (await objectExists(pool, 'column', table, addColumn[1])) continue;
      action = action.replace(/\s+IF\s+NOT\s+EXISTS/i, '');
    } else if (addIndex) {
      if (await objectExists(pool, 'index', table, addIndex[1])) continue;
      action = action.replace(/\s+IF\s+NOT\s+EXISTS/i, '');
    } else if (addConstraint) {
      if (await objectExists(pool, 'constraint', table, addConstraint[1])) continue;
      action = action.replace(/\s+IF\s+NOT\s+EXISTS/i, '');
    } else if (dropIndex) {
      if (!await objectExists(pool, 'index', table, dropIndex[1])) continue;
      action = action.replace(/\s+IF\s+EXISTS/i, '');
    }
    kept.push(action);
  }
  return kept.length ? `ALTER TABLE \`${table}\` ${kept.join(', ')}` : null;
}

async function runMigrations(pool, options = {}) {
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
    const unavailable = ['ECONNREFUSED', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST'].includes(e.code);
    return { baseline: 0, applied: 0, failed: unavailable ? 0 : 1, bootstrapped: 0, unavailable };
  }

  let files;
  try {
    files = fs.readdirSync(MIGRATIONS_DIR).filter(f => /^\d+.*\.sql$/.test(f)).sort();
  } catch (e) {
    logger.warn('[migrate] migrations dir unreadable:', e.message);
    restoreMigrationFlag();
    return { baseline: 0, applied: 0, failed: 1, bootstrapped: 0, unavailable: false };
  }

  let rows;
  try {
    [rows] = await pool.query('SELECT version FROM schema_migrations');
  } catch (e) {
    logger.error('[migrate] cannot read schema_migrations:', e.message);
    restoreMigrationFlag();
    return { baseline: 0, applied: 0, failed: 1, bootstrapped: 0, unavailable: false };
  }
  const applied = new Set(rows.map(r => r.version));

  // First run against an existing DB → baseline the historical migrations.
  let baseline = 0, bootstrapped = 0;
  if (applied.size === 0) {
    const [[schemaState]] = await pool.query(
      `SELECT COUNT(*) AS core_tables
         FROM information_schema.tables
        WHERE table_schema=DATABASE() AND table_name IN (${CORE_TABLES.map(() => '?').join(',')})`,
      CORE_TABLES
    );
    const coreTableCount = Number(schemaState?.core_tables || 0);
    if (coreTableCount === 0) {
      const schemaSql = options.schemaSql ?? fs.readFileSync(REFERENCE_SCHEMA, 'utf8');
      const schemaStatements = splitStatements(schemaSql)
        .filter(stmt => !/^\s*CREATE TABLE\s+`?schema_migrations`?\s*\(/i.test(stmt));
      logger.info(`[migrate] empty database detected; bootstrapping ${schemaStatements.length} reference-schema statements`);
      for (let index = 0; index < schemaStatements.length; index++) {
        const stmt = schemaStatements[index];
        try {
          await pool.query(stmt);
        } catch (error) {
          const identity = stmt.replace(/\s+/g, ' ').slice(0, 180);
          throw new Error(
            `[migrate] reference schema statement ${index + 1}/${schemaStatements.length} failed: ${identity} — ${error.message}`
          );
        }
      }
      bootstrapped = schemaStatements.length;
    } else if (coreTableCount !== CORE_TABLES.length) {
      throw new Error(
        `[migrate] partial database detected (${coreTableCount}/${CORE_TABLES.length} core tables); refusing historical baseline`
      );
    }
    for (const f of files) {
      const historical = migrationNumber(f) <= BASELINE_THROUGH;
      const emptySnapshotDataOnly = bootstrapped && EMPTY_SNAPSHOT_DATA_BASELINES.has(f);
      if (historical || emptySnapshotDataOnly) {
        const sum = checksumOf(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
        await pool.query(
          'INSERT IGNORE INTO schema_migrations (version, checksum, status) VALUES (?,?,?)',
          [f, sum, 'baseline']
        ).catch(() => {});
        applied.add(f);
        baseline++;
      }
    }
    if (baseline) logger.info(`[migrate] baselined ${baseline} historical/data-only migration(s)`);
  }

  let ranCount = 0, failed = 0;
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    const statements = splitStatements(sql);
    try {
      for (const stmt of statements) {
        const executable = await prepareIdempotentStatement(pool, stmt);
        if (executable) await pool.query(executable);
      }
      await pool.query(
        `INSERT INTO schema_migrations (version, checksum, status) VALUES (?,?,'applied')
         ON DUPLICATE KEY UPDATE checksum=VALUES(checksum), status='applied', applied_at=CURRENT_TIMESTAMP`,
        [f, checksumOf(sql)]
      );
      logger.info(`[migrate] applied ${f} (${statements.length} statements)`);
      ranCount++;
    } catch (e) {
      failed++;
      logger.error(`[migrate] FAILED ${f}: ${e.message} — stopping to avoid a partially-versioned schema`);
      break;
    }
  }
  if (ranCount === 0 && failed === 0) logger.info('[migrate] schema up to date');
  restoreMigrationFlag();
  return { baseline, applied: ranCount, failed, bootstrapped, unavailable: false };
  } finally {
    restoreMigrationFlag();
  }
}

module.exports = {
  runMigrations, BASELINE_THROUGH, CORE_TABLES, EMPTY_SNAPSHOT_DATA_BASELINES, splitStatements,
  splitAlterActions, prepareIdempotentStatement,
};
