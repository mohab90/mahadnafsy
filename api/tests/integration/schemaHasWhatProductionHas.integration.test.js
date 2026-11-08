'use strict';
/**
 * The schema a new server gets, asked of a database built from schema.sql and every migration (isolatedDb): that build is what proves no table names a column
 * or a key twice (MySQL refuses the whole CREATE TABLE on «Duplicate key name» — `uq_subs_tenant_phone` once stood twice on subscribers and a fresh database had no
 * clients table), and these are the tables and columns production has that a fresh server must have too. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
const skip = !ENABLED && 'no DB_* configured';
let pool;

before(async () => { if (ENABLED) ({ pool } = require('../../lib/db')); });
after(async () => { if (ENABLED) await pool.end(); });

const columns = async table => (await pool.query(
  'SELECT column_name AS name, column_default AS def, is_nullable AS nullable, column_type AS type FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=?', [table]))[0];

test('a fresh database has the tables production has', { skip }, async () => {
  const [tables] = await pool.query('SELECT table_name AS name FROM information_schema.tables WHERE table_schema=DATABASE()');
  const names = new Set(tables.map(row => row.name));
  assert.ok(names.size > 100, `only ${names.size} tables were built`);
  for (const table of ['community_event_registrations', 'customer_devices', 'incoming_transfers', 'subscriber_requests', 'push_subscriptions', 'subscribers']) {
    assert.ok(names.has(table), table);
  }
});

test('push subscriptions carry the staff they belong to, the admin flag and the index that finds a staff member\'s phones', { skip }, async () => {
  const cols = Object.fromEntries((await columns('push_subscriptions')).map(col => [col.name, col]));
  assert.equal(cols.staff_id?.type, 'varchar(36)');
  assert.equal(cols.staff_id.nullable, 'YES');
  assert.equal(cols.is_admin?.type, 'tinyint(1)');
  assert.equal(String(cols.is_admin.def), '0');
  const [index] = await pool.query("SELECT column_name AS name FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='push_subscriptions' AND index_name='idx_push_tenant_staff' ORDER BY seq_in_index");
  assert.deepEqual(index.map(row => row.name), ['tenant_id', 'staff_id', 'is_active']);
});

test('the columns later work depends on exist: a course\'s intake limit and a payment\'s linked transfer', { skip }, async () => {
  const any = async name => Number((await pool.query('SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema=DATABASE() AND column_name=?', [name]))[0][0].n);
  assert.ok(await any('intake_limit'));
  assert.ok(await any('linked_transfer_id'));
});
