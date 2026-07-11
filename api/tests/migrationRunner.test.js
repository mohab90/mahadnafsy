'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { runMigrations, BASELINE_THROUGH } = require('../lib/migrationRunner');

const migNum = (v) => parseInt(v, 10);
const migFiles = fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter(f => /^\d+.*\.sql$/.test(f));
const historicalCount = migFiles.filter(f => migNum(f) <= BASELINE_THROUGH).length;

// Mock pool: records the status written per migration version, and counts any
// statement that is NOT bookkeeping (i.e. an actual migration DDL/DML statement).
function mockPool() {
  const migTable = new Map(); // version -> status
  const stmtsRun = [];
  return {
    _migTable: migTable, _stmtsRun: stmtsRun,
    async query(sql, params) {
      const s = String(sql).trim();
      if (/CREATE TABLE IF NOT EXISTS schema_migrations/i.test(s)) return [[]];
      if (/^SELECT version FROM schema_migrations/i.test(s)) return [[...migTable.keys()].map(v => ({ version: v }))];
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
