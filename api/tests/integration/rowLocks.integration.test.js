'use strict';
// Do the row locks actually lock?
//
// Every money guard in this codebase rests on SELECT ... FOR UPDATE serialising
// two connections: the proof approval that must not create a second payment,
// the refund that must resolve once, the checkout that must not double-charge.
// The tests for those assert that the string appears in the source. None of
// them has ever run two connections at once.
//
// If one of these tables were MyISAM, or the isolation level were wrong, every
// one of those guards would be theatre and every one of those tests would still
// pass. This is the assumption underneath them, checked against the real engine.
//
// Nothing is committed — both transactions roll back — so it reads the database
// it runs against without changing it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { pool } = require('../../lib/db');

const MONEY_TABLES = ['payments', 'orders', 'journal_entries', 'enrollments', 'leads', 'subscribers'];

// Skipped on whether the database answers, not on whether it is configured.
//
// Checking the variables alone reports a database that is merely named — a
// developer whose .env points at a tunnel that is not up gets three failures
// about locks, when the truth is that nothing was asked. That is the same
// mistake the release gate makes when it reads a local environment and reports
// production as unconfigured.
let dbReachable = null;
async function hasDb() {
  if (dbReachable !== null) return dbReachable;
  if (!process.env.DB_NAME || !process.env.DB_USER) { dbReachable = false; return false; }
  try {
    await pool.query('SELECT 1');
    dbReachable = true;
  } catch {
    dbReachable = false;
  }
  return dbReachable;
}

test('every table a money guard locks is on an engine that has row locks', async (t) => {
  if (!(await hasDb())) return t.skip('database not reachable');
  const [rows] = await pool.query(
    `SELECT TABLE_NAME n, ENGINE e FROM information_schema.TABLES
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?)`, [MONEY_TABLES]);
  assert.ok(rows.length, 'none of the tables were found');
  const notInno = rows.filter(r => String(r.e).toLowerCase() !== 'innodb');
  assert.deepEqual(
    notInno.map(r => `${r.n}:${r.e}`), [],
    'a table on a non-row-locking engine makes FOR UPDATE a no-op',
  );
});

test('FOR UPDATE serialises two connections on the same row', async (t) => {
  if (!(await hasDb())) return t.skip('database not reachable');
  const [[row]] = await pool.query(
    "SELECT id FROM payments WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1");
  if (!row) return; // nothing to lock in an empty database

  const holder = await pool.getConnection();
  const contender = await pool.getConnection();
  try {
    // Short, so a working lock fails fast instead of hanging the suite.
    await holder.query('SET innodb_lock_wait_timeout = 3');
    await contender.query('SET innodb_lock_wait_timeout = 3');

    await holder.beginTransaction();
    await holder.query('SELECT id FROM payments WHERE id=? FOR UPDATE', [row.id]);

    await contender.beginTransaction();
    let blocked = false;
    let code = '';
    try {
      await contender.query('SELECT id FROM payments WHERE id=? FOR UPDATE', [row.id]);
    } catch (e) {
      blocked = true;
      code = e.code || '';
    }

    assert.ok(blocked, 'the second connection took the row while the first held it');
    assert.equal(code, 'ER_LOCK_WAIT_TIMEOUT', 'it was refused, but not by the lock');

    // The other half of the property: a plain read must not block, or every
    // report would stall behind whoever is recording a payment.
    const started = Date.now();
    await contender.query('SELECT id FROM payments WHERE id=?', [row.id]);
    assert.ok(Date.now() - started < 1000, 'an ordinary read waited on the lock');

    await contender.rollback();
    await holder.rollback();
  } finally {
    holder.release();
    contender.release();
  }
});

test('the isolation level is one where a held row stays held', async (t) => {
  if (!(await hasDb())) return t.skip('database not reachable');
  // READ-UNCOMMITTED would let a contender see a half-written row; the guards
  // read a row, decide, and write, and that decision has to be made on a
  // committed state.
  const [[iso]] = await pool.query('SELECT @@tx_isolation AS lvl');
  assert.ok(
    ['REPEATABLE-READ', 'SERIALIZABLE', 'READ-COMMITTED'].includes(String(iso.lvl)),
    `isolation is ${iso.lvl}, which does not hold a read-then-write decision`,
  );
});
