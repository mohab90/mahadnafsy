'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  runMigrations, BASELINE_THROUGH, EMPTY_SNAPSHOT_DATA_BASELINES,
  splitStatements, splitAlterActions, prepareIdempotentStatement,
} = require('../lib/migrationRunner');

const migNum = (v) => parseInt(v, 10);
const migFiles = fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter(f => /^\d+.*\.sql$/.test(f));
const historicalCount = migFiles.filter(f => migNum(f) <= BASELINE_THROUGH).length;

test('standalone migration command fails closed when the database is unavailable', () => {
  const cli = fs.readFileSync(path.join(__dirname, '..', 'tools', 'migrate.cjs'), 'utf8');
  assert.match(cli, /r\.failed > 0 \|\| r\.unavailable \? 1 : 0/);
});

// Mock pool: records the status written per migration version, and counts any
// statement that is NOT bookkeeping (i.e. an actual migration DDL/DML statement).
function mockPool({ coreTables = 5 } = {}) {
  const migTable = new Map(); // version -> status
  const stmtsRun = [];
  return {
    _migTable: migTable, _stmtsRun: stmtsRun,
    async query(sql, params) {
      const s = String(sql).trim();
      if (/CREATE TABLE IF NOT EXISTS schema_migrations/i.test(s)) return [[]];
      if (/^SELECT version FROM schema_migrations/i.test(s)) return [[...migTable.keys()].map(v => ({ version: v }))];
      if (/ AS object_exists/i.test(s)) {
        return [[{ object_exists: /information_schema\.tables/i.test(s) ? 1 : 0 }]];
      }
      if (/FROM information_schema\.tables/i.test(s)) return [[{ core_tables: coreTables }]];
      if (/INSERT (IGNORE )?INTO schema_migrations/i.test(s)) { migTable.set(params[0], params[2] || 'applied'); return [{}]; }
      stmtsRun.push(s.slice(0, 40));
      return [{}];
    },
  };
}

test('first run baselines the historical migrations without executing their SQL', async () => {
  const p = mockPool();
  const r = await runMigrations(p);
  assert.strictEqual(r.baseline, historicalCount, `should baseline all ${historicalCount} historical migrations`);
  // Every migration at or below the baseline threshold is recorded as 'baseline', never run.
  for (const [v, status] of p._migTable) {
    if (migNum(v) <= BASELINE_THROUGH) assert.strictEqual(status, 'baseline', `${v} must be baselined, not executed`);
  }
});

test('only migrations above the baseline threshold ever execute', async () => {
  const p = mockPool();
  await runMigrations(p);
  // Anything recorded as 'applied' (ran its SQL) must be a NEW migration (> threshold).
  for (const [v, status] of p._migTable) {
    if (status === 'applied') assert.ok(migNum(v) > BASELINE_THROUGH, `${v} ran but is not above the threshold`);
  }
});

test('a second run is a no-op (idempotent)', async () => {
  const p = mockPool();
  await runMigrations(p);          // first run: baseline + apply any new
  p._stmtsRun.length = 0;          // reset the statement counter
  const before = p._migTable.size;
  const r2 = await runMigrations(p);
  assert.strictEqual(r2.baseline, 0, 'nothing to baseline the second time');
  assert.strictEqual(r2.applied, 0, 'nothing new to apply the second time');
  assert.strictEqual(p._stmtsRun.length, 0, 'no statements run when already up to date');
  assert.strictEqual(p._migTable.size, before, 'no new rows recorded');
});

test('an empty database skips only legacy data backfills and runs structural migrations', async () => {
  const p = mockPool({ coreTables: 0 });
  const schemaSql = `
    CREATE TABLE courses (id INT PRIMARY KEY);
    CREATE TABLE schema_migrations (version VARCHAR(255) PRIMARY KEY);
  `;
  const r = await runMigrations(p, { schemaSql });
  assert.strictEqual(r.bootstrapped, 1, 'schema_migrations is owned by the runner and must be skipped');
  assert.ok(p._stmtsRun.some(s => /CREATE TABLE courses/i.test(s)), 'reference schema must execute');
  assert.strictEqual(
    r.baseline,
    historicalCount + EMPTY_SNAPSHOT_DATA_BASELINES.size,
    'pre-runner and legacy data-only migrations are baselined'
  );
  for (const migration of EMPTY_SNAPSHOT_DATA_BASELINES) {
    assert.strictEqual(p._migTable.get(migration), 'baseline', `${migration} must not replay on an empty snapshot`);
  }
  assert.strictEqual(p._migTable.get('144_v25_support_workflow_integrity.sql'), 'applied');
});

test('a partial database fails closed instead of receiving a false historical baseline', async () => {
  const p = mockPool({ coreTables: 2 });
  await assert.rejects(
    () => runMigrations(p),
    /partial database detected/,
  );
  assert.strictEqual(p._migTable.size, 0, 'no migration may be baselined on a partial schema');
});

test('ALTER action splitting preserves commas inside types and quoted values', () => {
  assert.deepStrictEqual(
    splitAlterActions("ADD COLUMN amount DECIMAL(12,2), ADD COLUMN label VARCHAR(50) DEFAULT 'a,b'"),
    ["ADD COLUMN amount DECIMAL(12,2)", "ADD COLUMN label VARCHAR(50) DEFAULT 'a,b'"]
  );
});

test('statement splitting removes full-line and inline comments without touching quoted dashes', () => {
  assert.deepStrictEqual(
    splitStatements("DROP INDEX IF EXISTS old_idx ON users; -- redundant\nINSERT INTO notes(value) VALUES ('a--b');"),
    ["DROP INDEX IF EXISTS old_idx ON users", "INSERT INTO notes(value) VALUES ('a--b')"]
  );
});

test('MariaDB idempotency guards become metadata-checked MySQL DDL', async () => {
  const existing = new Set(['table:subscribers', 'column:subscribers:tenant_id', 'index:subscribers:idx_old']);
  const pool = {
    async query(sql, params) {
      const kind = /information_schema\.columns/i.test(sql) ? 'column'
        : /information_schema\.statistics/i.test(sql) ? 'index' : 'table';
      return [[{ object_exists: existing.has(`${kind}:${params.join(':')}`) ? 1 : 0 }]];
    },
  };
  const prepared = await prepareIdempotentStatement(
    pool,
    `ALTER TABLE IF EXISTS subscribers
       ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64),
       ADD INDEX IF NOT EXISTS idx_tenant (tenant_id),
       DROP INDEX IF EXISTS idx_old`
  );
  assert.doesNotMatch(prepared, /IF (?:NOT )?EXISTS/i);
  assert.doesNotMatch(prepared, /ADD COLUMN tenant_id/i);
  assert.match(prepared, /ADD INDEX idx_tenant/);
  assert.match(prepared, /DROP INDEX idx_old/);
});
