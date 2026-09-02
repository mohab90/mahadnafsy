// Read-only. The unaudited payments were treated as a legacy backlog. Their
// latest created_at is two days old, so that framing is worth testing: if new
// payments still arrive without an audit row, something writing payments is
// not going through the audited path.
require('dotenv').config({ path: '/var/www/mahad-api/.env' });
const mysql = require('mysql2/promise');

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  console.log('===== audited share by month =====');
  const [months] = await db.query(`
    SELECT DATE_FORMAT(p.created_at, '%Y-%m') AS month,
           COUNT(*) AS payments,
           SUM(EXISTS (SELECT 1 FROM payment_audit_log a WHERE a.payment_id = p.id)) AS audited
      FROM payments p
     WHERE p.deleted_at IS NULL
     GROUP BY month ORDER BY month`);
  for (const row of months) {
    const pct = Math.round((row.audited / row.payments) * 100);
    console.log(`${row.month}  ${String(row.audited).padStart(3)}/${String(row.payments).padEnd(3)}  ${String(pct).padStart(3)}%`);
  }

  console.log('\n===== who creates the unaudited ones (source / method) =====');
  const [by] = await db.query(`
    SELECT COALESCE(p.source, '(null)') AS source, p.payment_method, COUNT(*) AS n,
           MAX(DATE(p.created_at)) AS latest
      FROM payments p
     WHERE p.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM payment_audit_log a WHERE a.payment_id = p.id)
     GROUP BY source, p.payment_method ORDER BY n DESC`);
  console.table(by);

  console.log('\n===== the 12 most recent unaudited payments =====');
  const [recent] = await db.query(`
    SELECT p.id, p.amount_egp, p.status, p.source, p.payment_method,
           p.staff_id, p.staff_name, p.created_at
      FROM payments p
     WHERE p.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM payment_audit_log a WHERE a.payment_id = p.id)
     ORDER BY p.created_at DESC LIMIT 12`);
  console.table(recent);

  console.log('\n===== for contrast, the 6 most recent audited payments =====');
  const [ok] = await db.query(`
    SELECT p.id, p.amount_egp, p.source, p.payment_method, p.created_at,
           (SELECT a.action FROM payment_audit_log a WHERE a.payment_id = p.id ORDER BY a.created_at LIMIT 1) AS first_action
      FROM payments p
     WHERE p.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM payment_audit_log a WHERE a.payment_id = p.id)
     ORDER BY p.created_at DESC LIMIT 6`);
  console.table(ok);

  await db.end();
})().catch(error => { console.error('ERR', error.message); process.exit(1); });
