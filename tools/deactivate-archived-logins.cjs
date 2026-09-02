// Bring the data in line with the archive fix.
//
// Archiving a customer disables their sign-in account. It matched on email
// alone, so customers with no email kept a live account; this deactivates the
// ones that slipped through. It is exactly what archiving them was meant to
// do, and the restore endpoint reverses it.
//
// Only accounts belonging to an already-archived subscriber are touched, and
// only role='user'. A staff or admin account cannot be reached from here.
//
//   node tools/deactivate-archived-logins.cjs          # dry run
//   node tools/deactivate-archived-logins.cjs --apply
require('dotenv').config({ path: '/var/www/mahad-api/.env' });
const fs = require('fs');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  const [targets] = await db.query(`
    SELECT u.id AS user_id, u.email AS user_email, u.role,
           s.id AS subscriber_id, s.client_code, s.name, s.deleted_at
      FROM subscribers s
      JOIN users u ON u.id = s.firebase_uid AND u.tenant_id = s.tenant_id
     WHERE s.deleted_at IS NOT NULL AND u.is_active = 1 AND u.role = 'user'`);

  console.log(`accounts belonging to archived customers, still active: ${targets.length}`);
  console.table(targets.map(t => ({
    client_code: t.client_code, name: String(t.name || '').slice(0, 28),
    archived: String(t.deleted_at).slice(0, 10), role: t.role,
  })));

  const wrongRole = targets.filter(t => t.role !== 'user');
  if (wrongRole.length) {
    console.error('ABORT: a non-customer account was matched.', wrongRole);
    process.exitCode = 1;
    await db.end();
    return;
  }
  if (!targets.length || !APPLY) {
    if (targets.length) console.log('\ndry run -- nothing written. re-run with --apply');
    await db.end();
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `/var/www/mahad-api/db-backups/archived-logins-${stamp}.json`;
  fs.mkdirSync('/var/www/mahad-api/db-backups', { recursive: true });
  fs.writeFileSync(backup, JSON.stringify(targets, null, 2));
  console.log('\nbackup written:', backup);

  const ids = targets.map(t => t.user_id);
  const [result] = await db.query(
    "UPDATE users SET is_active=0 WHERE role='user' AND id IN (?)", [ids]);
  console.log(`accounts deactivated: ${result.affectedRows}`);

  const [[left]] = await db.query(`
    SELECT COUNT(*) AS n FROM subscribers s
      JOIN users u ON u.id = s.firebase_uid AND u.tenant_id = s.tenant_id
     WHERE s.deleted_at IS NOT NULL AND u.is_active = 1`);
  console.log(`archived customers still holding a live account: ${left.n}`);

  await db.end();
})().catch(error => { console.error('ERR', error.message); process.exit(1); });
