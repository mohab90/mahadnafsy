'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { runMigrations, BASELINE_THROUGH } = require('../lib/migrationRunner');

// Mock pool: records what runMigrations would write, and counts any statement
// that is NOT bookkeeping (i.e. an actual migration DDL/DML statement).
function mockPool() {
  const migTable = new Map();
  const stmtsRun = [];
  return {
    _migTable: migTable, _stmtsRun: stmtsRun,
    async query(sql, params) {
      const s = String(sql).trim();
      if (/CREATE TABLE IF NOT EXISTS schema_migrations/i.test(s)) return [[]];
      if (/^SELECT version FROM schema_migrations/i.test(s)) return [[...migTable.keys()].map(v => ({ version: v }))];
      if (/INSERT (IGNORE )?INTO schema_migrations/i.test(s)) { migTable.set(params[0], { status: params[2] || 'applied' }); return [{}]; }
      stmtsRun.push(s.slice(0, 40));
      return [{}];
    },
  };
}

test('first run against an existing DB baselines history WITHOUT executing any migration SQL', async () => {
  const p = mockPool();
  const r = await runMigrations(p);
  assert.ok(r.baseline > 0, 'should baseline the historical migrations');
  assert.strictEqual(r.applied, 0, 'nothing new to apply on first run');
  assert.strictEqual(p._stmtsRun.length, 0, 'baseline must run ZERO migration statements');
  assert.ok([...p._migTable.values()].every(v => v.status === 'baseline'), 'all recorded as baseline');
});

test('only migrations numbered above the baseline threshold would ever execute', async () => {
  const p = mockPool();
  await runMigrations(p);
  // every recorded version must be <= BASELINE_THROUGH (nothing newer exists yet)
  const nums = [...p._migTable.keys()].map(v => parseInt(v, 10));
  assert.ok(nums.every(n => n <= BASELINE_THROUGH), 'baseline only covers <= threshold');
});

test('a second run is a no-op (idempotent)', async () => {
  const p = mockPool();
  await runMigrations(p);
  const before = p._migTable.size;
  const r2 = await runMigrations(p);
  assert.strictEqual(r2.baseline, 0);
  assert.strictEqual(r2.applied, 0);
  assert.strictEqual(p._stmtsRun.length, 0);
  assert.strictEqual(p._migTable.size, before);
});
