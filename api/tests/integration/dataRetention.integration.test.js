'use strict';
/**
 * The nightly trim (lib/dataRetention.js) and the activity-log archive
 * (lib/archiveJob.js) against a real MariaDB: old finished rows go, recent and
 * unfinished ones stay, a sent message keeps its row and dedupe key but not its
 * body. Runs only with DB_* (or TEST_DB_*), scoped to its own tenant.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-ops-it';
const OLD = '2024-01-01 00:00:00';
let pool;

const TABLES = ['job_queue', 'connector_events', 'message_outbox', 'login_history', 'notifications', 'admin_notifications', 'activity_logs', 'activity_logs_archive'];
async function clean() {
  for (const table of TABLES) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]);
}
const ids = async (sql, params = []) => (await pool.query(sql, [...params, TENANT]))[0].map(row => row.id).sort();

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  const q = (sql, params) => pool.query(sql, params);
  for (const [id, status, doneAt] of [['jq-old-done', 'done', OLD], ['jq-new-done', 'done', null], ['jq-old-dead', 'dead', OLD]]) {
    await q(`INSERT INTO job_queue (id, tenant_id, job_type, payload_json, status, run_at, done_at)
             VALUES (?, ?, 'ops_it', '{}', ?, NOW(), ${doneAt ? '?' : 'NOW()'})`, [id, TENANT, status, ...(doneAt ? [doneAt] : [])]);
  }
  for (const [id, status, at] of [['ce-old-done', 'processed', OLD], ['ce-old-failed', 'failed', OLD], ['ce-new-done', 'processed', null]]) {
    await q(`INSERT INTO connector_events (id, tenant_id, provider, external_event_id, payload_json, status, received_at)
             VALUES (?, ?, 'ops_it', ?, '{}', ?, ${at ? '?' : 'NOW()'})`, [id, TENANT, id, status, ...(at ? [at] : [])]);
  }
  const body = JSON.stringify({ message: 'x'.repeat(500), category: 'payment' });
  for (const [id, status, at] of [['mo-old-sent', 'sent', OLD], ['mo-old-dead', 'dead', OLD], ['mo-new-sent', 'sent', null]]) {
    await q(`INSERT INTO message_outbox (id, tenant_id, channel, recipient, payload_json, status, dedupe_key, created_at)
             VALUES (?, ?, 'whatsapp', '201000000000', ?, ?, ?, ${at ? '?' : 'NOW()'})`, [id, TENANT, body, status, `ops-it:${id}`, ...(at ? [at] : [])]);
  }
  await q(`INSERT INTO login_history (tenant_id, email, status, created_at) VALUES (?, 'old@ops.it', 'success', ?), (?, 'new@ops.it', 'success', NOW())`, [TENANT, OLD, TENANT]);
  await q(`INSERT INTO notifications (id, tenant_id, type, title, message, read_at, created_at) VALUES
           ('nt-old-read', ?, 'x', 't', 'm', ?, ?), ('nt-old-unread', ?, 'x', 't', 'm', NULL, ?), ('nt-new-read', ?, 'x', 't', 'm', NOW(), NOW())`,
  [TENANT, OLD, OLD, TENANT, OLD, TENANT]);
  await q(`INSERT INTO admin_notifications (tenant_id, type, title, message, is_read, created_at) VALUES
           (?, 'x', 'old-read', 'm', 1, ?), (?, 'x', 'old-unread', 'm', 0, ?)`, [TENANT, OLD, TENANT, OLD]);
  await q(`INSERT INTO activity_logs (id, tenant_id, action, entity, entity_id, label, actor, at, actor_name, department, details) VALUES
           ('al-old', ?, 'update', 'lead', 'l1', 'old', 'a@x', ?, 'Old Actor', 'sales', '{"k":1}'), ('al-new', ?, 'update', 'lead', 'l1', 'new', 'a@x', NOW(), NULL, NULL, NULL)`,
  [TENANT, OLD, TENANT]);
});

after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end().catch(() => {});
});

test('old finished rows are trimmed, recent and unfinished ones stay', { skip }, async () => {
  const { runDataRetention } = require('../../lib/dataRetention');
  // A batch of one proves the loop keeps going until a short batch.
  const summary = await runDataRetention({ pool, logger: null, tenantId: TENANT, batch: 1, gapMs: 0 });
  assert.equal(summary['job_queue done'], 1);
  assert.deepEqual(await ids('SELECT id FROM job_queue WHERE tenant_id=?'), ['jq-new-done', 'jq-old-dead']);
  assert.deepEqual(await ids('SELECT id FROM connector_events WHERE tenant_id=?'), ['ce-new-done', 'ce-old-failed']);
  assert.deepEqual(await ids('SELECT email AS id FROM login_history WHERE tenant_id=?'), ['new@ops.it']);
  assert.deepEqual(await ids('SELECT id FROM notifications WHERE tenant_id=?'), ['nt-new-read', 'nt-old-unread']);
  assert.deepEqual(await ids('SELECT title AS id FROM admin_notifications WHERE tenant_id=?'), ['old-unread']);

  const [outbox] = await pool.query('SELECT id, payload_json, payload_pruned_at, dedupe_key FROM message_outbox WHERE tenant_id=? ORDER BY id', [TENANT]);
  assert.equal(outbox.length, 3, 'every message keeps its row');
  const json = value => (typeof value === 'string' ? JSON.parse(value) : value);
  const byId = Object.fromEntries(outbox.map(row => [row.id, { ...row, payload: json(row.payload_json) }]));
  assert.deepEqual(byId['mo-old-sent'].payload, { category: 'payment' });
  assert.ok(byId['mo-old-sent'].payload_pruned_at);
  assert.equal(byId['mo-old-sent'].dedupe_key, 'ops-it:mo-old-sent');
  assert.equal(byId['mo-old-dead'].payload.message.length, 500, 'a failed message keeps its body for a retry');
  assert.equal(byId['mo-new-sent'].payload.message.length, 500);

  const again = await runDataRetention({ pool, logger: null, tenantId: TENANT, gapMs: 0 });
  assert.ok(Object.values(again).every(n => n === 0), 'a second pass finds nothing');
});

test('a rule set to 0 days is off', { skip }, async () => {
  const { runDataRetention } = require('../../lib/dataRetention');
  await pool.query("UPDATE job_queue SET done_at=? WHERE id='jq-new-done'", [OLD]);
  const summary = await runDataRetention({ pool, logger: null, tenantId: TENANT, gapMs: 0, env: { RETENTION_JOB_QUEUE_DAYS: '0' } });
  assert.equal(summary['job_queue done'], undefined);
  assert.deepEqual(await ids('SELECT id FROM job_queue WHERE tenant_id=?'), ['jq-new-done', 'jq-old-dead']);
});

test('the activity archive moves old rows with every column', { skip }, async () => {
  const { archiveActivityLogs } = require('../../lib/archiveJob');
  const result = await archiveActivityLogs(pool, { tenantId: TENANT, batch: 1 });
  assert.equal(result.moved, 1);
  assert.deepEqual(await ids('SELECT id FROM activity_logs WHERE tenant_id=?'), ['al-new']);
  const [[archived]] = await pool.query("SELECT actor_name, department, details FROM activity_logs_archive WHERE id='al-old'");
  assert.deepEqual({ ...archived }, { actor_name: 'Old Actor', department: 'sales', details: '{"k":1}' });
});
