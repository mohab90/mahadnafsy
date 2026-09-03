// Give the rows that only have branch_id their legacy branch string back.
//
// Two columns carry the same fact: `branch` ('ONLINE_EGYPT') and `branch_id`
// ('branch-online-egypt'). Nine subscribers have branch_id set and branch NULL,
// and row-level scoping filters on the string — lib/leadAccess.js builds
// `AND s.branch IN (...)`, and routes/admin/stafflists.js does the same in four
// places. So those customers are invisible to any staff member scoped to a
// branch, including the online manager whose branch they actually belong to.
// The integration suite asserts this cannot happen ("post-backfill invariant")
// and has been failing.
//
// The mapping is lib/branches.js's own branchForId, imported rather than copied,
// so this cannot drift from what the application believes.
//
//   node tools/backfill-missing-branch.cjs          # dry run
//   node tools/backfill-missing-branch.cjs --apply
require('dotenv').config({ path: '/var/www/mahad-api/.env' });
const fs = require('fs');
const mysql = require('mysql2/promise');
const { branchForId } = require('/var/www/mahad-api/lib/branches');

const APPLY = process.argv.includes('--apply');

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  const report = async (table) => {
    const [rows] = await db.query(
      `SELECT id, branch, branch_id FROM \`${table}\`
        WHERE (branch IS NULL OR branch = '')`);
    const fixable = rows.filter(row => row.branch_id);
    const stuck = rows.filter(row => !row.branch_id);
    return { table, rows, fixable, stuck };
  };

  const results = [await report('subscribers'), await report('leads')];

  for (const { table, rows, fixable, stuck } of results) {
    console.log(`${table}: ${rows.length} without a branch string — ${fixable.length} have a branch_id to derive it from, ${stuck.length} have neither`);
    const byTarget = {};
    for (const row of fixable) {
      const target = branchForId(row.branch_id);
      byTarget[target] = (byTarget[target] || 0) + 1;
    }
    for (const [target, count] of Object.entries(byTarget)) {
      console.log(`  ${count} -> ${target}`);
    }
    if (stuck.length) {
      console.log(`  NOT touched (no branch_id): ${stuck.slice(0, 5).map(r => r.id).join(', ')}`);
    }
  }

  const total = results.reduce((sum, r) => sum + r.fixable.length, 0);
  if (!total) { console.log('\nnothing to backfill'); await db.end(); return; }
  if (!APPLY) { console.log('\ndry run -- nothing written. re-run with --apply'); await db.end(); return; }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `/var/www/mahad-api/db-backups/branch-backfill-${stamp}.json`;
  fs.mkdirSync('/var/www/mahad-api/db-backups', { recursive: true });
  fs.writeFileSync(backup, JSON.stringify(
    Object.fromEntries(results.map(r => [r.table, r.fixable])), null, 2));
  console.log('\nbackup written:', backup);

  await db.beginTransaction();
  try {
    for (const { table, fixable } of results) {
      let changed = 0;
      for (const row of fixable) {
        const target = branchForId(row.branch_id);
        // Guarded so a row that gained a branch between the read and the write
        // is left alone rather than overwritten.
        const [result] = await db.query(
          `UPDATE \`${table}\` SET branch = ?
            WHERE id = ? AND (branch IS NULL OR branch = '')`,
          [target, row.id]);
        changed += result.affectedRows;
      }
      console.log(`${table}: ${changed} row(s) given a branch`);
    }
    await db.commit();
  } catch (error) {
    await db.rollback();
    console.error('rolled back, nothing changed:', error.message);
    process.exitCode = 1;
    await db.end();
    return;
  }

  for (const table of ['subscribers', 'leads']) {
    const [[left]] = await db.query(
      `SELECT COUNT(*) n FROM \`${table}\` WHERE branch IS NULL OR branch = ''`);
    console.log(`${table} still without a branch: ${left.n}`);
  }

  await db.end();
})().catch(error => { console.error('ERR', error.message); process.exit(1); });
