'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const audit = require('../tools/orphan-row-audit.cjs');

const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

// Minimal reader of the mysqldump in schema.sql: columns, foreign keys, indexes per table.
function readSchema(sql) {
  const tables = {};
  for (const m of sql.matchAll(/CREATE TABLE `(\w+)` \(\n([\s\S]*?)\n\) ENGINE=InnoDB DEFAULT CHARSET=(\w+)/g)) {
    const t = { cols: {}, fkCols: new Set(), charset: m[3] };
    for (const line of m[2].split('\n')) {
      const l = line.trim();
      let c;
      if ((c = l.match(/^`(\w+)` (\w+)(?:\([^)]*\))?(.*)$/))) t.cols[c[1]] = { base: c[2].toLowerCase(), rest: c[3] };
      else if ((c = l.match(/^CONSTRAINT `\w+` FOREIGN KEY \(([^)]*)\)/))) {
        c[1].replace(/`/g, '').split(',').forEach(x => t.fkCols.add(x.trim()));
      }
    }
    tables[m[1]] = t;
  }
  return tables;
}
const schema = readSchema(schemaSql);

test('every candidate relation names a real column and a real parent key', () => {
  assert.ok(Object.keys(schema).length > 200, 'schema reader found the tables');
  for (const rel of audit.CANDIDATES) {
    assert.ok(schema[rel.table], `${rel.spec}: child table ${rel.table} exists`);
    assert.ok(schema[rel.table].cols[rel.column], `${rel.spec}: column exists`);
    assert.ok(schema[rel.parent], `${rel.spec}: parent table ${rel.parent} exists`);
    assert.ok(schema[rel.parent].cols[rel.parentColumn], `${rel.spec}: parent key exists`);
  }
});

test('candidates are unique and none already has a foreign key', () => {
  const seen = new Set();
  for (const rel of audit.CANDIDATES) {
    assert.ok(!seen.has(rel.key), `duplicate candidate ${rel.key}`);
    seen.add(rel.key);
    assert.ok(!schema[rel.table].fkCols.has(rel.column), `${rel.key} already has a foreign key`);
  }
});

test('child and parent columns could be joined by a foreign key (same type, same charset)', () => {
  for (const rel of audit.CANDIDATES) {
    const child = schema[rel.table], parent = schema[rel.parent];
    assert.strictEqual(child.cols[rel.column].base, parent.cols[rel.parentColumn].base, `${rel.spec}: type`);
    assert.strictEqual(child.charset, parent.charset, `${rel.spec}: charset`);
    for (const side of [child.cols[rel.column], parent.cols[rel.parentColumn]]) {
      assert.ok(!/COLLATE/i.test(side.rest), `${rel.spec}: unexpected column-level collation`);
    }
  }
});

test('tenant and soft-delete flags match the real tables', () => {
  for (const rel of audit.CANDIDATES) {
    const child = schema[rel.table], parent = schema[rel.parent];
    const bothTenant = Boolean(child.cols.tenant_id && parent.cols.tenant_id);
    assert.strictEqual(rel.tenant, bothTenant, `${rel.spec}: tenant flag`);
    assert.strictEqual(rel.softDelete, Boolean(child.cols.deleted_at), `${rel.spec}: soft-delete flag`);
  }
});

test('money relations are tier 1 and tier 1 never points at a table that cascades money away', () => {
  const tier1 = audit.selectCandidates({ tier: 1 }).map(r => r.key);
  for (const key of ['refunds.payment_id', 'refund_requests.payment_id', 'installment_entries.plan_id',
    'installment_plans.payment_id', 'orders.subscriber_id', 'payroll_items.payroll_run_id',
    'box_withdrawals.journal_entry_id', 'instructor_fees.source_payment_id']) {
    assert.ok(tier1.includes(key), `${key} is tier 1`);
  }
  assert.ok(audit.selectCandidates({ tier: 3 }).length > audit.selectCandidates({ tier: 1 }).length);
  assert.deepStrictEqual(audit.selectCandidates({ only: ['refunds.payment_id'] }).map(r => r.key), ['refunds.payment_id']);
});

test('the counting query reports orphans, blanks, live orphans and cross-tenant rows without writing', () => {
  const rel = audit.CANDIDATES.find(r => r.key === 'refund_requests.payment_id');
  const sql = audit.buildOrphanQuery(rel);
  assert.match(sql, /^SELECT /);
  assert.match(sql, /FROM `refund_requests` c LEFT JOIN `payments` p ON p\.`id` = c\.`payment_id`/);
  assert.match(sql, /WHERE c\.`payment_id` IS NOT NULL$/);
  assert.match(sql, /c\.`deleted_at` IS NULL/, 'soft-deleting child gets a live count');
  assert.match(sql, /p\.`tenant_id` <> c\.`tenant_id`/, 'both tenant scoped: cross-tenant is counted');
  assert.strictEqual(audit.assertReadOnly(sql), sql);

  const noTenant = audit.parseCandidate('support_messages.ticket_id>support_tickets', 3);
  assert.strictEqual(noTenant.tenant, false);
  assert.match(audit.buildOrphanQuery(noTenant), /NULL AS cross_tenant/);
  assert.match(audit.buildOrphanQuery(noTenant), /NULL AS live_orphans/);
});

test('every generated query passes the read-only guard', () => {
  for (const rel of audit.CANDIDATES) {
    for (const sql of [audit.buildOrphanQuery(rel), audit.buildSampleQuery(rel), audit.buildCompatQuery(rel)]) {
      assert.doesNotThrow(() => audit.assertReadOnly(sql), rel.spec);
    }
  }
});

test('the read-only guard refuses writes, DDL and multi-statement input', () => {
  for (const bad of [
    'UPDATE payments SET amount = 0', 'DELETE FROM payments', 'INSERT INTO t VALUES (1)', 'ALTER TABLE t ADD c INT',
    'DROP TABLE t', 'SELECT 1; DELETE FROM t', 'SELECT * FROM t INTO OUTFILE \'/tmp/x\'', 'CALL p()', 'TRUNCATE t',
  ]) {
    assert.throws(() => audit.assertReadOnly(bad), /refusing/, bad);
  }
  assert.doesNotThrow(() => audit.assertReadOnly('SET SESSION TRANSACTION READ ONLY'));
  assert.throws(() => audit.assertReadOnly('SET SESSION foreign_key_checks = 0'), /refusing/);
});

test('identifiers that are not plain names are refused when a query is built', () => {
  const evil = { table: 'payments`; DROP TABLE x; --', column: 'id', parent: 'subscribers', parentColumn: 'id', tenant: false, softDelete: false };
  assert.throws(() => audit.buildOrphanQuery(evil), /unsafe identifier/);
});

test('it will not run without explicit database settings', () => {
  assert.throws(() => audit.requireDbEnv({}), /missing: DB_HOST, DB_PORT, DB_USER, DB_NAME, DB_PASSWORD/);
  assert.throws(() => audit.requireDbEnv({ DB_HOST: 'h', DB_USER: 'u', DB_NAME: 'n', DB_PASSWORD: 'p' }), /DB_PORT/);
  const conf = audit.requireDbEnv({ DB_HOST: 'h', DB_PORT: '3397', DB_USER: 'u', DB_NAME: 'n', DB_PASSWORD: '' });
  assert.deepStrictEqual(conf, { host: 'h', port: 3397, user: 'u', password: '', database: 'n' });

  const env = { ...process.env };
  for (const k of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_NAME', 'DB_PASSWORD']) delete env[k];
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'orphan-row-audit.cjs')], { env, encoding: 'utf8', cwd: path.join(__dirname, '..') });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /refusing to run without explicit database settings/);
});

test('type and collation mismatches are reported, matching columns are not', () => {
  const a = { column_type: 'varchar(36)', charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci' };
  assert.deepStrictEqual(audit.compareColumnTypes(a, { ...a, column_type: 'varchar(100)' }), { ok: true, reason: '' });
  assert.strictEqual(audit.compareColumnTypes(a, { ...a, collation: 'utf8mb4_uca1400_ai_ci' }).ok, false);
  assert.match(audit.compareColumnTypes(a, { ...a, collation: 'utf8mb4_uca1400_ai_ci' }).reason, /collation/);
  assert.match(audit.compareColumnTypes(a, { ...a, column_type: 'int(11)' }).reason, /type/);
  assert.match(audit.compareColumnTypes(a, { ...a, charset: 'ascii' }).reason, /charset/);
  assert.strictEqual(audit.compareColumnTypes(a, null).ok, false);
});

test('the summary counts orphans and lists the relations ready for a key', () => {
  const s = audit.summarize([
    { spec: 'a.x>b', orphans: 0, compat: { ok: true } },
    { spec: 'c.y>d', orphans: 4, cross_tenant: 1, compat: { ok: true } },
    { spec: 'e.z>f', orphans: 0, compat: { ok: false } },
    { spec: 'g.w>h', orphans: 0, skipped: 'already has a foreign key' },
  ]);
  assert.deepStrictEqual(s, {
    relations: 4, with_orphans: 1, orphan_rows: 4, cross_tenant_rows: 1,
    incompatible_types: 1, skipped: 1, ready_for_fk: ['a.x>b'],
  });
});

test('generated foreign keys restrict and never cascade, and docs/FOREIGN_KEYS_PLAN.sql is the generator output', () => {
  const sql = audit.emitSql(audit.selectCandidates({ tier: 1 }));
  assert.ok(sql.includes('ON DELETE RESTRICT ON UPDATE RESTRICT'));
  assert.ok(!/CASCADE|SET NULL/i.test(sql.replace(/RESTRICT/g, '')));
  assert.strictEqual((sql.match(/ADD CONSTRAINT/g) || []).length, audit.selectCandidates({ tier: 1 }).length);
  for (const name of sql.matchAll(/ADD CONSTRAINT `(\w+)`/g)) assert.ok(name[1].length <= 64);
  const plan = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'FOREIGN_KEYS_PLAN.sql'), 'utf8');
  assert.ok(plan.includes(sql), 'docs/FOREIGN_KEYS_PLAN.sql is stale: run node api/tools/orphan-row-audit.cjs --emit-sql --tier 1');
});

test('the argument parser accepts the documented flags and rejects others', () => {
  assert.deepStrictEqual(audit.parseArgs(['--tier', '1', '--json', '--only', 'a.b,c.d', '--no-samples']),
    { tier: 1, json: true, emitSql: false, only: ['a.b', 'c.d'], samples: false });
  assert.throws(() => audit.parseArgs(['--apply']), /unknown argument/);
});
