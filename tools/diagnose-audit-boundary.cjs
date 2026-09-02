// Read-only. Is the audit gap a closed backlog or a live leak? If every
// payment created after the audit fix went live carries an audit row, the 165
// are history and need a decision, not a fix. If any payment created after it
// does not, something is still writing payments outside the audited path.
require('dotenv').config({ path: '/var/www/mahad-api/.env' });
const mysql = require('mysql2/promise');

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  const [[boundary]] = await db.query(`
    SELECT MIN(p.created_at) AS first_audited
      FROM payments p
     WHERE p.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM payment_audit_log a
                    WHERE a.payment_id = p.id AND a.action = 'create')
       AND p.created_at >= '2026-08-25'`);
  console.log('first payment audited at creation:', boundary.first_audited);

  const [[lastGap]] = await db.query(`
    SELECT MAX(p.created_at) AS last_unaudited
      FROM payments p
     WHERE p.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM payment_audit_log a WHERE a.payment_id = p.id)`);
  console.log('last payment with no audit row :', lastGap.last_unaudited);

  const [after] = await db.query(`
    SELECT p.id, p.amount_egp, p.source, p.created_at
      FROM payments p
     WHERE p.deleted_at IS NULL
       AND p.created_at > ?
       AND NOT EXISTS (SELECT 1 FROM payment_audit_log a WHERE a.payment_id = p.id)
     ORDER BY p.created_at`, [boundary.first_audited]);
  console.log(`\nunaudited payments created AFTER the fix went live: ${after.length}`);
  if (after.length) console.table(after);

  const [[since]] = await db.query(`
    SELECT COUNT(*) AS n,
           SUM(EXISTS (SELECT 1 FROM payment_audit_log a WHERE a.payment_id = p.id)) AS audited
      FROM payments p
     WHERE p.deleted_at IS NULL AND p.created_at > ?`, [boundary.first_audited]);
  console.log(`payments since the fix: ${since.n}, audited: ${since.audited}`);

  await db.end();
})().catch(error => { console.error('ERR', error.message); process.exit(1); });
