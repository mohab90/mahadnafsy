'use strict';
/**
 * Audit retention, on a real MariaDB (these were regular expressions over lib/hrAuditRetentionJob.js — `audit_retention_days`, `LIMIT 5000`, `INSERT IGNORE INTO audit_logs_archive`
 * … `DELETE live FROM audit_logs` in one transaction): each institute's own policy decides how long its audit rows stay live — never less than a year, never more than ten; what
 * is older is first copied to the archive (immutable, with its hash chain) and only then removed from the live table, the same rows each time it runs; the HR trail is trimmed by
 * the same cutoff; an institute with no policy and a newer row are left alone; and a failure leaves both tables as they were. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const SHORT = 'tenant-retain-short'; const LONG = 'tenant-retain-long'; const NONE = 'tenant-retain-none';
let pool; let job;
const logger = { warn: () => {}, info: () => {}, error: () => {} };

const live = async tenant => (await pool.query('SELECT id FROM audit_logs WHERE tenant_id=? ORDER BY id', [tenant]))[0].map(row => row.id);
const archived = async tenant => (await pool.query('SELECT id FROM audit_logs_archive WHERE tenant_id=? ORDER BY id', [tenant]))[0].map(row => row.id);
const hr = async tenant => (await pool.query('SELECT id FROM hr_audit_logs WHERE tenant_id=? ORDER BY id', [tenant]))[0].map(row => row.id);

async function clean() {
  for (const tenant of [SHORT, LONG, NONE]) {
    for (const table of ['audit_logs_archive', 'audit_logs', 'hr_audit_logs', 'hr_policy_versions']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [tenant]).catch(() => {});
  }
}
const audit = (tenant, id, daysAgo) => pool.query(
  `INSERT INTO audit_logs (id, tenant_id, action, severity, event_hash, hash_version, created_at) VALUES (?, ?, 'test.event', 'info', ?, 1, DATE_SUB(NOW(), INTERVAL ? DAY))`,
  [id, tenant, `${id}`.padEnd(64, '0').slice(0, 64), daysAgo]);
const hrRow = (tenant, id, daysAgo) => pool.query(
  "INSERT INTO hr_audit_logs (id, tenant_id, action, entity_type, performed_at) VALUES (?, ?, 'x', 'staff', DATE_SUB(NOW(), INTERVAL ? DAY))", [id, tenant, daysAgo]);
const policy = (tenant, days) => pool.query(
  "INSERT INTO hr_policy_versions (id, tenant_id, version, audit_retention_days, weekend_days_json, effective_from) VALUES (?, ?, 1, ?, '[5]', '2020-01-01')", [`pol-${tenant}`, tenant, days]);

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  job = require('../../lib/hrAuditRetentionJob');
  await clean();
  for (const tenant of [SHORT, LONG, NONE]) await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [tenant, tenant]);
  await policy(SHORT, 10);   // asks for 10 days: clamped up to a year
  await policy(LONG, 20000); // asks for 55 years: clamped down to ten
  // SHORT: 400 days old (older than the one-year floor), 200 days old (inside it), a fresh one
  await audit(SHORT, 'a-short-old', 400); await audit(SHORT, 'a-short-mid', 200); await audit(SHORT, 'a-short-new', 1);
  await audit(LONG, 'a-long-4y', 1500); await audit(LONG, 'a-long-11y', 4100);
  await audit(NONE, 'a-none-old', 3000);
  await hrRow(SHORT, 'h-short-old', 400); await hrRow(SHORT, 'h-short-new', 5); await hrRow(NONE, 'h-none-old', 3000);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('each institute\'s policy decides, within a year and ten; old rows are archived first and then leave the live table; the HR trail follows', { skip }, async () => {
  await job.runHrAuditRetention({ pool, logger });
  assert.deepEqual(await live(SHORT), ['a-short-mid', 'a-short-new'], 'a policy of 10 days is a year at least: 200 days stays, 400 goes');
  assert.deepEqual(await archived(SHORT), ['a-short-old'], 'and what went is in the archive');
  assert.deepEqual(await live(LONG), ['a-long-4y'], 'a policy of 55 years is ten at most: 4 years stays, 11 goes');
  assert.deepEqual(await archived(LONG), ['a-long-11y']);
  assert.deepEqual(await hr(SHORT), ['h-short-new'], 'the HR trail is trimmed by the same cutoff');
  assert.deepEqual(await live(NONE), ['a-none-old'], 'an institute with no policy is left alone');
  assert.deepEqual(await hr(NONE), ['h-none-old']);
  assert.deepEqual(await archived(NONE), []);
});

test('running it again changes nothing, and a failure leaves both tables as they were', { skip }, async () => {
  await job.runHrAuditRetention({ pool, logger });
  assert.deepEqual([await live(SHORT), await archived(SHORT)], [['a-short-mid', 'a-short-new'], ['a-short-old']], 'the same rows, once');

  await audit(SHORT, 'a-short-old2', 500);
  const failing = { getConnection: async () => {
    const conn = await pool.getConnection();
    const query = conn.query.bind(conn);
    conn.query = (sql, params) => (/hr_audit_logs/.test(sql) && (params || [])[0] === SHORT ? Promise.reject(new Error('disk full')) : query(sql, params));
    return conn;
  }, query: (...args) => pool.query(...args) };
  const seen = [];
  await job.runHrAuditRetention({ pool: failing, logger: { ...logger, warn: (...args) => seen.push(args.join(' ')) } });
  assert.match(seen.join(), /disk full/, 'the failure is reported, not thrown');
  assert.ok((await live(SHORT)).includes('a-short-old2'), 'rolled back: the row is still live');
  assert.ok(!(await archived(SHORT)).includes('a-short-old2'), 'and not half-archived');
});
