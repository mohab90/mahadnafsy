'use strict';
/**
 * The startup sweep that seals plaintext authenticator secrets
 * (lib/totpSecretSweep.js), against a real MariaDB: legacy rows in users and
 * staff are sealed and still open to the same secret, a sealed row and an
 * empty one are left exactly as they were, and a second run finds nothing.
 * Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-totp-sweep-it';
const LEGACY = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

let pool; let twoFactor; let sweep; let alreadySealed;

async function clean() {
  await pool.query('DELETE FROM users WHERE tenant_id=?', [TENANT]).catch(() => {});
  await pool.query('DELETE FROM staff WHERE tenant_id=?', [TENANT]).catch(() => {});
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  twoFactor = require('../../lib/twoFactor');
  sweep = require('../../lib/totpSecretSweep');
  await clean();
  alreadySealed = twoFactor.sealTotpSecret(LEGACY);
  const rows = [
    ['u-sweep-legacy', 'sweep-legacy@example.test', LEGACY],
    ['u-sweep-sealed', 'sweep-sealed@example.test', alreadySealed],
    ['u-sweep-none', 'sweep-none@example.test', null],
  ];
  for (const [id, email, secret] of rows) {
    await pool.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, name, role, is_active, session_version, totp_secret, totp_enabled)
       VALUES (?, ?, ?, 'x', ?, 'staff', 1, 1, ?, ?)`, [id, TENANT, email, email, secret, secret ? 1 : 0]);
    await pool.query(
      `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, totp_secret, totp_enabled)
       VALUES (?, ?, ?, ?, '1012340000', 'SALES', 1, '2025-01-01', ?, ?)`,
      [id.replace('u-', 'st-'), TENANT, email, email, secret, secret ? 1 : 0]);
  }
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

const secretsOf = async table => Object.fromEntries((await pool.query(
  `SELECT id, totp_secret FROM ${table} WHERE tenant_id=?`, [TENANT]))[0].map(r => [r.id, r.totp_secret]));

test('plaintext secrets in users and staff are sealed; sealed and empty ones are untouched', { skip }, async () => {
  const totals = await sweep.sealPlaintextTotpSecrets({ pool });
  assert.ok(totals.users.sealed >= 1 && totals.staff.sealed >= 1);
  const users = await secretsOf('users');
  const staff = await secretsOf('staff');
  for (const stored of [users['u-sweep-legacy'], staff['st-sweep-legacy']]) {
    assert.ok(twoFactor.isSealedSecret(stored));
    assert.ok(!stored.includes(LEGACY));
    assert.equal(twoFactor.readTotpSecret(stored).secret, LEGACY);
  }
  assert.equal(users['u-sweep-sealed'], alreadySealed);
  assert.equal(staff['st-sweep-sealed'], alreadySealed);
  assert.equal(users['u-sweep-none'], null);
  assert.equal(staff['st-sweep-none'], null);
});

test('a second run finds nothing left to seal', { skip }, async () => {
  const before = { users: await secretsOf('users'), staff: await secretsOf('staff') };
  const totals = await sweep.sealPlaintextTotpSecrets({ pool });
  assert.deepEqual(totals, { users: { sealed: 0, skipped: 0 }, staff: { sealed: 0, skipped: 0 } });
  assert.deepEqual({ users: await secretsOf('users'), staff: await secretsOf('staff') }, before);
});
