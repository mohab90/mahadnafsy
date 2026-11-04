'use strict';
/**
 * lib/autoLinkAccounts.js against a real MariaDB: a site account is linked to the client who holds its number or its proven e-mail, never by name,
 * never when two clients match, never on an unproven e-mail, and never over an account the client already has. Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-autolink-it';
let pool, autoLinkAccounts;

async function clean() {
  for (const table of ['subscribers', 'users', 'staff']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]);
}
const user = (id, email, phone, unverified = 0) => pool.query(
  "INSERT INTO users (id, tenant_id, email, phone, password_hash, name, role, is_active, email_unverified) VALUES (?, ?, ?, ?, 'x', ?, 'user', 1, ?)",
  [id, TENANT, email, phone, `حساب ${id}`, unverified]);
// phone_digits is a generated column: the client's number read as digits.
const client = (id, name, email, phone, uid = null) => pool.query(
  'INSERT INTO subscribers (id, tenant_id, client_code, name, email, phone, firebase_uid, branch, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, \'ONLINE_EGYPT\', 1)',
  [id, TENANT, `AL${id}`, name, email, phone, uid]);
const uidOf = async id => (await pool.query('SELECT firebase_uid FROM subscribers WHERE id=? AND tenant_id=?', [id, TENANT]))[0][0].firebase_uid;

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  ({ autoLinkAccounts } = require('../../lib/autoLinkAccounts'));
  await clean();
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('the same number, in any spelling, links the account to the client', { skip }, async () => {
  await user('al-u1', 'u1@x.test', '+20 101 555 1001');
  await client('al-s1', 'سارة', null, '01015551001');
  const done = await autoLinkAccounts(pool, { tenantId: TENANT });
  assert.equal(done.number, 1);
  assert.equal(await uidOf('al-s1'), 'al-u1');
});

test('a proven e-mail links; an unproven one links nobody', { skip }, async () => {
  await user('al-u2', 'proven@x.test', null, 0);
  await user('al-u3', 'unproven@x.test', null, 1);
  await client('al-s2', 'منى', 'Proven@X.test', null);
  await client('al-s3', 'هبة', 'unproven@x.test', null);
  await autoLinkAccounts(pool, { tenantId: TENANT });
  assert.equal(await uidOf('al-s2'), 'al-u2');
  assert.equal(await uidOf('al-s3'), null);
});

// The database refuses two live clients with the same digits (uq_subs_tenant_phone_slot), but one number can be stored in two spellings.
test('two clients holding one number in two spellings are contested: nobody is linked', { skip }, async () => {
  await user('al-u4', 'u4@x.test', '01015551004');
  await client('al-s4a', 'أ', null, '01015551004');
  await client('al-s4b', 'ب', null, '1015551004');
  const done = await autoLinkAccounts(pool, { tenantId: TENANT });
  assert.equal(done.contested, 1);
  assert.equal(await uidOf('al-s4a'), null);
  assert.equal(await uidOf('al-s4b'), null);
});

test('a client who already has a live account is never taken over, and a name alone never links', { skip }, async () => {
  await user('al-u5', 'u5@x.test', '01015551005');
  await user('al-u6', 'u6@x.test', null);
  await client('al-s5', 'ليلى', null, '01015551005', 'al-u6');
  await client('al-s6', 'حساب al-u6', null, null);
  await autoLinkAccounts(pool, { tenantId: TENANT });
  assert.equal(await uidOf('al-s5'), 'al-u6');
  assert.equal(await uidOf('al-s6'), null);
});

test('linking fills the client\'s empty e-mail and number from the account', { skip }, async () => {
  await user('al-u7', 'u7@x.test', '01015551007');
  await client('al-s7', 'نهى', null, '01015551007');
  await autoLinkAccounts(pool, { tenantId: TENANT, userIds: ['al-u7'] });
  const [[row]] = await pool.query('SELECT email, phone FROM subscribers WHERE id=? AND tenant_id=?', ['al-s7', TENANT]);
  assert.equal(row.email, 'u7@x.test');
  assert.equal(row.phone, '01015551007');
});
