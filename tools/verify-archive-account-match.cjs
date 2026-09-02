// Read-only. Runs the archive/restore account-matching predicate as a SELECT
// against the live data, to prove three things before it is ever used as an
// UPDATE: the SQL is valid, it finds the customer's own account including the
// 17 stored as role='client', and it refuses to touch a staff account.
require('dotenv').config({ path: '/var/www/mahad-api/.env' });
const mysql = require('mysql2/promise');

const CUSTOMER_ROLES = ['user', 'client', 'student'];

function customerAccountMatch(sub) {
  const email = sub.email ? String(sub.email).toLowerCase().trim() : null;
  const arms = [];
  const params = [];
  if (email) { arms.push('LOWER(TRIM(u.email))=?'); params.push(email); }
  if (sub.firebase_uid) { arms.push('u.id=?'); params.push(sub.firebase_uid); }
  if (!arms.length) return null;
  return {
    sql: `u.role IN (${CUSTOMER_ROLES.map(() => '?').join(',')})
            AND (${arms.join(' OR ')})
            AND NOT EXISTS (
              SELECT 1 FROM staff st
               WHERE st.tenant_id=u.tenant_id
                 AND (st.firebase_uid=u.id OR LOWER(TRIM(st.email))=LOWER(TRIM(u.email))))`,
    params: (tenantId) => [tenantId, ...CUSTOMER_ROLES, ...params],
  };
}

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  const probe = async (label, sub, tenantId) => {
    const match = customerAccountMatch(sub);
    if (!match) return console.log(`${label}: no match arms (no email, no uid) -> nothing would be touched`);
    const [rows] = await db.query(
      `SELECT u.id, u.email, u.role, u.is_active FROM users u WHERE u.tenant_id=? AND ${match.sql}`,
      match.params(tenantId));
    console.log(`${label}: would touch ${rows.length} account(s) ${JSON.stringify(rows.map(r => ({ role: r.role, active: r.is_active })))}`);
    return rows;
  };

  console.log('===== the account the old role=\'user\' filter missed =====');
  const [[videoTest]] = await db.query(
    "SELECT id, email, firebase_uid, tenant_id, name FROM subscribers WHERE client_code='C115204' LIMIT 1");
  await probe("C115204 'Video Test Temp' (role=client)", videoTest, videoTest.tenant_id);

  console.log('\n===== a staff member who also has a subscriber record =====');
  const [staffLinked] = await db.query(`
    SELECT s.id, s.email, s.firebase_uid, s.tenant_id, s.name, s.client_code, u.role
      FROM subscribers s JOIN users u ON u.id = s.firebase_uid AND u.tenant_id = s.tenant_id
     WHERE u.role = 'staff' LIMIT 3`);
  console.log(`found ${staffLinked.length} such subscriber(s)`);
  for (const sub of staffLinked) {
    await probe(`  ${sub.client_code} ${String(sub.name || '').slice(0, 22)} (users.role=${sub.role})`, sub, sub.tenant_id);
  }

  console.log('\n===== every archived customer still holding a live account =====');
  const [stragglers] = await db.query(`
    SELECT s.id, s.email, s.firebase_uid, s.tenant_id, s.client_code, s.name, u.role
      FROM subscribers s JOIN users u ON u.id = s.firebase_uid AND u.tenant_id = s.tenant_id
     WHERE s.deleted_at IS NOT NULL AND u.is_active = 1`);
  console.log(`count: ${stragglers.length}`);
  for (const sub of stragglers) {
    await probe(`  ${sub.client_code} ${String(sub.name || '').slice(0, 22)} (users.role=${sub.role})`, sub, sub.tenant_id);
  }

  await db.end();
})().catch(error => { console.error('ERR', error.message); process.exit(1); });
