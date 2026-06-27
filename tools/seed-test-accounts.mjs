#!/usr/bin/env node
// Creates (or deletes) disposable test staff accounts for the admin e2e net.
// All accounts share the password TestPass123! and use @local.test emails.
//
//   node tools/seed-test-accounts.mjs           # create + print env exports
//   node tools/seed-test-accounts.mjs --delete  # remove them
//
// They write to whatever DB api/.env points at — delete them when done.
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const apiRequire = createRequire(join(ROOT, 'api', 'package.json'));
const mysql = apiRequire('mysql2/promise');
const bcrypt = apiRequire('bcryptjs');
const { randomUUID } = await import('crypto');

const env = {};
for (const l of readFileSync(join(ROOT, 'api', '.env'), 'utf8').split('\n')) {
  const m = l.trim().match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const PASS = 'TestPass123!';
const ACCTS = [
  ['admin',           'test-admin@local.test',      'TEST admin'],
  ['manager',         'test-manager@local.test',    'TEST manager'],
  ['sales',           'test-sales@local.test',      'TEST sales'],
  ['collection',      'test-collection@local.test', 'TEST collection'],
  ['reception_daqqi', 'test-daqqi@local.test',      'TEST daqqi'],
];
const DELETE = process.argv.includes('--delete');

const c = await mysql.createConnection({
  host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER,
  password: env.DB_PASSWORD, database: env.DB_NAME, connectTimeout: 20000,
});

const emails = ACCTS.map(a => a[1]);
if (DELETE) {
  const [u] = await c.query('DELETE FROM users WHERE email IN (?,?,?,?,?)', emails);
  const [s] = await c.query('DELETE FROM staff WHERE email IN (?,?,?,?,?)', emails);
  console.log(`deleted users:${u.affectedRows} staff:${s.affectedRows}`);
} else {
  const hash = await bcrypt.hash(PASS, 10);
  const [[row]] = await c.query('SELECT employment_type FROM staff WHERE employment_type IS NOT NULL LIMIT 1');
  const empType = row ? row.employment_type : 'FULL_TIME';
  for (const [role, email, name] of ACCTS) {
    await c.query(
      'INSERT INTO users (id,email,password_hash,name,role,is_active) VALUES (?,?,?,?,?,1) ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash),role=VALUES(role),is_active=1',
      [randomUUID(), email, hash, name, role]);
    await c.query(
      "INSERT INTO staff (id,name,email,phone,role,joined_at,is_active,created_at,employment_type,tenant_id) VALUES (?,?,?,?,?,NOW(),1,NOW(),?,'mahad') ON DUPLICATE KEY UPDATE role=VALUES(role),is_active=1",
      [randomUUID(), name, email, '0100000000', role, empType]);
  }
  console.log('Created 5 test accounts (password: ' + PASS + '). Export for the e2e:\n');
  console.log(`export TEST_ADMIN_EMAIL=test-admin@local.test TEST_ADMIN_PASSWORD=${PASS}`);
  console.log(`export TEST_MANAGER_EMAIL=test-manager@local.test TEST_MANAGER_PASSWORD=${PASS}`);
  console.log(`export TEST_SALES_EMAIL=test-sales@local.test TEST_SALES_PASSWORD=${PASS}`);
  console.log(`export TEST_COLLECTION_EMAIL=test-collection@local.test TEST_COLLECTION_PASSWORD=${PASS}`);
  console.log(`export TEST_DAQQI_EMAIL=test-daqqi@local.test TEST_DAQQI_PASSWORD=${PASS}`);
  console.log('\nWhen done:  node tools/seed-test-accounts.mjs --delete');
}
await c.end();
