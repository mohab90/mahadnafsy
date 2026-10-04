'use strict';
/**
 * Scheduled jobs against a real MariaDB: one process runs a job at a time, and
 * one tenant failing does not cost the others their run.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
const skip = !ENABLED && 'no DB_* configured';
const { forEachActiveTenant } = require('../../lib/scheduledTenants');
const { pool } = require('../../lib/db');
after(() => pool.end().catch(() => {}));

test('two processes firing the same job at the same minute run it once', { skip }, async () => {
  let runs = 0;
  async function reminderJob() { runs++; await new Promise(resolve => setTimeout(resolve, 300)); }
  // One run per active tenant — however many this database holds.
  const [[{ tenants }]] = await pool.query("SELECT GREATEST(COUNT(*), 1) AS tenants FROM tenants WHERE status='active'");
  // A second pool stands in for the second process: GET_LOCK is per connection.
  const mysql = require('mysql2/promise');
  const other = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  try {
    await Promise.all([forEachActiveTenant(reminderJob), forEachActiveTenant(reminderJob, other)]);
  } finally { await other.end(); }
  assert.equal(runs, Number(tenants), 'the second process skipped the run');
  await forEachActiveTenant(reminderJob);
  assert.equal(runs, 2 * Number(tenants), 'the lock is released once the run ends');
});

test('one tenant failing does not skip the rest', { skip }, async () => {
  const fake = {
    getConnection: () => pool.getConnection(),
    query: async () => [[{ id: 'tenant-a' }, { id: 'tenant-b' }, { id: 'tenant-c' }]],
  };
  const seen = [];
  async function dailyReport(tenantId) { seen.push(tenantId); if (tenantId === 'tenant-a') throw new Error('boom'); }
  await forEachActiveTenant(dailyReport, fake);
  assert.deepEqual(seen, ['tenant-a', 'tenant-b', 'tenant-c']);
});
