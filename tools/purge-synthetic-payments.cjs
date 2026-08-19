// Remove the load-test and UAT leftovers from the live books.
//
// Soft delete, not a hard one: the column exists, every financial query already
// honours it, and a reversible removal is the right shape for a change to
// accounting records. The journal entries that made them count as revenue are
// removed in the same transaction — leaving those behind would take the
// payments off the payment screens while the totals stayed wrong.
//
// Only ids that are unmistakably synthetic. Nothing is matched on amount or
// date, so a real payment cannot be caught by accident.
require('dotenv').config({ path: '/var/www/mahad-api/.env' });
const fs = require('fs');
const mysql = require('mysql2/promise');

const PATTERNS = ['LOAD-TXN-%', 'QA-TXN-%', 'UAT-TXN-%'];

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const where = PATTERNS.map(() => 'transaction_id LIKE ?').join(' OR ');

  const [targets] = await c.query(
    `SELECT id, transaction_id, amount_egp, status, date FROM payments
      WHERE deleted_at IS NULL AND (${where})`, PATTERNS);
  console.log('synthetic payments found:', targets.length);
  console.table(targets);
  if (!targets.length) { await c.end(); return; }

  const backup = `/var/www/mahad-api/db-backups/synthetic-payments-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const ids = targets.map(t => t.id);
  const [journals] = await c.query(
    `SELECT * FROM journal_entries WHERE ref_type='payment' AND ref_id IN (${ids.map(() => '?').join(',')})`, ids);
  fs.writeFileSync(backup, JSON.stringify({ payments: targets, journal_entries: journals }, null, 2));
  console.log('\nbackup written:', backup);
  console.log('journal entries they created:', journals.length);

  await c.beginTransaction();
  try {
    const [p] = await c.query(
      `UPDATE payments SET deleted_at = NOW() WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    let lines = 0, entries = 0;
    if (journals.length) {
      const jIds = journals.map(j => j.id);
      const [l] = await c.query(
        `DELETE FROM journal_entry_lines WHERE entry_id IN (${jIds.map(() => '?').join(',')})`, jIds);
      const [e] = await c.query(
        `DELETE FROM journal_entries WHERE id IN (${jIds.map(() => '?').join(',')})`, jIds);
      lines = l.affectedRows; entries = e.affectedRows;
    }
    await c.commit();
    console.log(`\npayments soft-deleted : ${p.affectedRows}`);
    console.log(`journal entries removed: ${entries} (${lines} lines)`);
  } catch (e) {
    await c.rollback();
    console.error('rolled back:', e.message);
    process.exitCode = 1;
  }

  const [[after]] = await c.query(
    "SELECT COUNT(*) n, COALESCE(SUM(amount_egp),0) total FROM payments WHERE deleted_at IS NULL AND status='paid'");
  console.log(`\nlive paid payments now: ${after.n} totalling ${after.total} EGP`);
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
