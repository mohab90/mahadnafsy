// Give paid and refunded payments the branch their own customer already has.
//
// smoke:live-db reports "7 paid/refunded payment(s) have no branch_id". Every
// one of those seven belongs to a subscriber whose branch is ONLINE_EGYPT, so
// the branch is known — the payment simply did not inherit it.
//
// It matters because financial scoping filters on the payment's own column:
// routes/orders.js passes branchColumn `<record>.branch_id` into
// financialScopeClause, which appends `AND <record>.branch_id = ?`. A NULL
// there is not "unscoped", it is excluded — so 12,857 EGP of real revenue is
// invisible to any staff member scoped to the branch those customers belong to.
//
// The mapping comes from lib/branches.js rather than a copy, and only rows
// whose subscriber has a branch are touched. Anything without one is left and
// reported.
//
//   node tools/backfill-payment-branch.cjs          # dry run
//   node tools/backfill-payment-branch.cjs --apply
require('dotenv').config({ path: '/var/www/mahad-api/.env' });
const fs = require('fs');
const mysql = require('mysql2/promise');
const { branchIdForBranch } = require('/var/www/mahad-api/lib/branches');

const APPLY = process.argv.includes('--apply');

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  const [rows] = await db.query(`
    SELECT p.id, p.amount_egp, p.status, p.branch AS pay_branch, p.branch_id AS pay_branch_id,
           s.id AS sub_id, s.name, s.branch AS sub_branch, s.branch_id AS sub_branch_id
      FROM payments p
      JOIN subscribers s ON s.id = p.subscriber_id
     WHERE p.deleted_at IS NULL
       AND p.status IN ('paid', 'refunded')
       AND (p.branch_id IS NULL OR p.branch_id = '')`);

  const fixable = rows.filter(r => r.sub_branch && branchIdForBranch(r.sub_branch, null));
  const stuck = rows.filter(r => !fixable.includes(r));
  const money = fixable.reduce((sum, r) => sum + Number(r.amount_egp || 0), 0);

  console.log(`payments with no branch_id : ${rows.length}`);
  console.log(`their customer has a branch: ${fixable.length} (${money.toLocaleString('en-US')} EGP)`);
  console.log(`no branch to inherit       : ${stuck.length}`);
  const byTarget = {};
  for (const r of fixable) {
    const target = branchIdForBranch(r.sub_branch);
    byTarget[`${r.sub_branch} / ${target}`] = (byTarget[`${r.sub_branch} / ${target}`] || 0) + 1;
  }
  for (const [target, n] of Object.entries(byTarget)) console.log(`  ${n} -> ${target}`);
  if (stuck.length) console.log(`  NOT touched: ${stuck.map(r => r.id).slice(0, 5).join(', ')}`);

  if (!fixable.length) { await db.end(); return; }
  if (!APPLY) { console.log('\ndry run -- nothing written. re-run with --apply'); await db.end(); return; }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `/var/www/mahad-api/db-backups/payment-branch-backfill-${stamp}.json`;
  fs.mkdirSync('/var/www/mahad-api/db-backups', { recursive: true });
  fs.writeFileSync(backup, JSON.stringify(fixable, null, 2));
  console.log('\nbackup written:', backup);

  await db.beginTransaction();
  try {
    let changed = 0;
    for (const r of fixable) {
      // Guarded on still-empty so a row that gained a branch between the read
      // and the write is left as it is.
      const [res] = await db.query(
        `UPDATE payments SET branch = ?, branch_id = ?
          WHERE id = ? AND (branch_id IS NULL OR branch_id = '')`,
        [r.sub_branch, branchIdForBranch(r.sub_branch), r.id]);
      changed += res.affectedRows;
    }
    await db.commit();
    console.log(`payments given a branch: ${changed}`);
  } catch (error) {
    await db.rollback();
    console.error('rolled back, nothing changed:', error.message);
    process.exitCode = 1;
    await db.end();
    return;
  }

  const [[left]] = await db.query(`
    SELECT COUNT(*) AS n FROM payments
     WHERE deleted_at IS NULL AND status IN ('paid','refunded')
       AND (branch_id IS NULL OR branch_id = '')`);
  console.log(`still without a branch_id: ${left.n}`);
  await db.end();
})().catch(error => { console.error('ERR', error.message); process.exit(1); });
