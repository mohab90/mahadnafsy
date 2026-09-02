// Read-only. The archive matched the sign-in account by email alone, so a
// customer with no email kept a live account. This counts who that left
// behind, and separates the ones the old code could never have reached (no
// email) from the ones it should have caught.
require('dotenv').config({ path: '/var/www/mahad-api/.env' });
const mysql = require('mysql2/promise');

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  const [rows] = await db.query(`
    SELECT s.client_code, s.name, s.deleted_at,
           (s.email IS NULL OR TRIM(s.email) = '') AS no_email,
           u.id AS user_id, u.is_active
      FROM subscribers s
      JOIN users u ON u.id = s.firebase_uid AND u.tenant_id = s.tenant_id
     WHERE s.deleted_at IS NOT NULL AND u.is_active = 1
     ORDER BY s.deleted_at DESC`);

  console.log(`archived customers whose sign-in account is still active: ${rows.length}`);
  console.table(rows.map(r => ({
    client_code: r.client_code,
    name: String(r.name || '').slice(0, 28),
    archived: String(r.deleted_at).slice(0, 10),
    had_no_email: r.no_email ? 'yes' : 'no',
  })));

  const unreachable = rows.filter(r => r.no_email).length;
  console.log(`\nof these, ${unreachable} had no email, so the old email-only UPDATE could never have disabled them`);
  console.log(`the other ${rows.length - unreachable} had one, so something else left them active`);

  const [[all]] = await db.query(
    'SELECT COUNT(*) n FROM subscribers WHERE deleted_at IS NOT NULL');
  console.log(`(out of ${all.n} archived customers)`);

  await db.end();
})().catch(error => { console.error('ERR', error.message); process.exit(1); });
