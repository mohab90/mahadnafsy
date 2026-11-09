'use strict';
/**
 * Who a guard lets in and with what authority, on a real MariaDB (these were regular expressions over middleware/auth.js: `FULL_ACCESS_ROLES` and
 * `req.isSuperAdmin = true` inside four guard functions). A staff account whose ROLE is admin or manager is a full-access caller in every guard that
 * resolves a staff record, without its address being in an environment list; the narrower guards let in exactly the roles they name and raise the flag for
 * none but the two top ones; a deactivated account and a stranger are refused. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-authority-it';
let pool; let auth;

const ROLES = ['admin', 'manager', 'online_manager', 'collection', 'sales'];
const emailOf = role => `${role}-au@example.test`;

async function run(guard, email) {
  const req = { user: { uid: `u-${email}`, email, tenant_id: T }, tenantId: T, headers: {}, params: {}, body: {}, query: {} };
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  let passed = false;
  await guard(req, res, () => { passed = true; });
  return { passed, superAdmin: Boolean(req.isSuperAdmin), status: passed ? 200 : res.statusCode };
}

async function clean() {
  await pool.query('DELETE FROM staff WHERE tenant_id=?', [T]).catch(() => {});
  await pool.query('DELETE FROM tenant_settings WHERE tenant_id=?', [T]).catch(() => {});
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  auth = require('../../middleware/auth');
  let n = 0;
  for (const role of ROLES) {
    n += 1;
    await pool.query("INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES (?, ?, ?, ?, ?, ?, 1, '2024-01-01')", [`st-au-${role}`, T, role, emailOf(role), `101234050${n}`, role.toUpperCase()]);
  }
  await pool.query("INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES ('st-au-off', ?, 'off', 'off-au@example.test', '1012340509', 'ADMIN', 0, '2024-01-01')", [T]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

/** guard → { role → [passes, raises the flag] } */
const MATRIX = {
  requireAdmin: { admin: [1, 1], manager: [1, 1], online_manager: [0, 0], collection: [0, 0], sales: [0, 0] },
  requireSuperAdmin: { admin: [1, 1], manager: [1, 1], online_manager: [0, 0], collection: [0, 0], sales: [0, 0] },
  requireAdminOrOnlineManager: { admin: [1, 1], manager: [1, 1], online_manager: [1, 0], collection: [0, 0], sales: [0, 0] },
  requireAdminOrOnlineManagerOrCollection: { admin: [1, 1], manager: [1, 1], online_manager: [1, 0], collection: [1, 0], sales: [0, 0] },
  requireAdminOrStaff: { admin: [1, 1], manager: [1, 1], online_manager: [1, 0], collection: [1, 0], sales: [1, 0] },
};

for (const [name, expected] of Object.entries(MATRIX)) {
  test(`${name}: the roles it admits, and which of them it treats as full access`, { skip }, async () => {
    for (const role of ROLES) {
      const got = await run(auth[name], emailOf(role));
      assert.deepEqual([got.passed ? 1 : 0, got.superAdmin ? 1 : 0], expected[role], `${role}: ${JSON.stringify(got)}`);
    }
    const stranger = await run(auth[name], 'stranger-au@example.test');
    assert.equal(stranger.passed, false, 'an address that is no staff member');
    assert.equal(stranger.status, 403);
    const off = await run(auth[name], 'off-au@example.test');
    assert.equal(off.passed, false, 'a deactivated admin');
  });
}
