'use strict';
/**
 * The integration runner gives every file a database of its own
 * (tests/integration/support/isolatedDb.mjs): a fresh copy of the migrated
 * schema, with none of the rows another file wrote. Runs only with DB_*, and
 * only checks the copy when the file was started by `npm run test:integration`.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
const ISOLATED = process.env.MAHAD_IT_DB_READY === String(process.pid);
const skip = (!ENABLED && 'no DB_* configured') || (!ISOLATED && 'not started through the isolating runner');
let pool;
after(async () => { if (pool) await pool.end().catch(() => {}); });

test('this file runs on a fresh copy of the migrated schema', { skip }, async () => {
  ({ pool } = require('../../lib/db'));
  const [[{ name }]] = await pool.query('SELECT DATABASE() AS name');
  assert.match(name, /^mahad_it_[0-9a-f]{4}_\d+_/);
  assert.equal(name, process.env.DB_NAME);
  const [[migrations]] = await pool.query('SELECT COUNT(*) AS n FROM schema_migrations');
  assert.ok(Number(migrations.n) > 250, 'every migration is recorded');
  for (const table of ['leads', 'payments', 'orders', 'subscribers', 'staff']) {
    const [[row]] = await pool.query(`SELECT COUNT(*) AS n FROM ${table}`);
    assert.equal(Number(row.n), 0, `${table} starts empty`);
  }
  const [[fks]] = await pool.query(
    'SELECT COUNT(*) AS n FROM information_schema.referential_constraints WHERE constraint_schema=DATABASE()');
  assert.ok(Number(fks.n) > 0, 'foreign keys came with the copy');
  const [[triggers]] = await pool.query('SELECT COUNT(*) AS n FROM information_schema.triggers WHERE trigger_schema=DATABASE()');
  assert.ok(Number(triggers.n) > 0, 'triggers came with the copy');
});
