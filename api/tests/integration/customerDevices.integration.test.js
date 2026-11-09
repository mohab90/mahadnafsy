'use strict';
/**
 * A customer's devices, on a real MariaDB (these were regular expressions over lib/customerDevices.js — `STALE_DEVICE_DAYS`, `last_seen_at < ? ORDER BY last_seen_at ASC LIMIT 1`,
 * `if (!stale) throw deviceLimitError()`): an account is open on two devices; the same device signing in again only refreshes itself; a third is refused (DEVICE_LIMIT) while both
 * are in use; a place not used for a month is given to the new device, and only that one; the device id is kept as a keyed hash, never as the cookie; a browser with no cookie is given one
 * that the page cannot read; and each account, in each institute, has its own places. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
delete process.env.CUSTOMER_MAX_DEVICES; delete process.env.CUSTOMER_DEVICE_STALE_DAYS;
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-devices-it'; const OTHER = 'tenant-devices-other';
let pool; let devices;

const browser = id => ({ headers: { cookie: `mahadDevice=${id}` }, get: () => 'test-browser', ip: '10.0.0.1', socket: { remoteAddress: '10.0.0.1' } });
const signIn = async (tenantId, userId, id) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await devices.registerCustomerDevice(conn, { tenantId, userId, req: browser(id) });
    await conn.commit();
    return result;
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
};
const count = async (tenantId, userId) => (await pool.query('SELECT COUNT(*) AS n FROM customer_devices WHERE tenant_id=? AND user_id=?', [tenantId, userId]))[0][0].n;

async function clean() {
  for (const tenant of [T, OTHER]) {
    await pool.query('DELETE FROM customer_devices WHERE tenant_id=?', [tenant]).catch(() => {});
    await pool.query('DELETE FROM users WHERE tenant_id=?', [tenant]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  devices = require('../../lib/customerDevices');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active'), (?, ?, 'IT2', 'active')", [T, T, OTHER, OTHER]);
  for (const [tenant, id, email] of [[T, 'us-dv-1', 'one-dv@example.test'], [T, 'us-dv-2', 'two-dv@example.test'], [OTHER, 'us-dv-o', 'one-dv@example.test']]) {
    await pool.query("INSERT INTO users (id, tenant_id, email, phone, password_hash, name, role, is_active) VALUES (?, ?, ?, NULL, 'x', 'عميلة', 'user', 1)", [id, tenant, email]);
  }
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('an account is open on two devices; the same device again only refreshes itself; a third is refused while both are in use', { skip }, async () => {
  const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
  assert.deepEqual(await signIn(T, 'us-dv-1', a), { deviceCount: 1, known: false });
  assert.deepEqual(await signIn(T, 'us-dv-1', b), { deviceCount: 2, known: false });
  assert.deepEqual(await signIn(T, 'us-dv-1', a), { deviceCount: 2, known: true }, 'a device already on the list takes no place');
  await assert.rejects(signIn(T, 'us-dv-1', c), error => error.statusCode === 403 && error.code === 'DEVICE_LIMIT');
  assert.equal(await count(T, 'us-dv-1'), 2, 'the refusal added nothing');
  assert.equal(await signIn(T, 'us-dv-2', c).then(r => r.deviceCount), 1, 'another account has its own places');
  assert.equal(await signIn(OTHER, 'us-dv-o', c).then(r => r.deviceCount), 1, 'and another institute\'s account too');
});

test('a place not used for a month is given to the new device, and only that one; the id is kept hashed', { skip }, async () => {
  const [a, b] = (await pool.query('SELECT device_hash FROM customer_devices WHERE tenant_id=? AND user_id=? ORDER BY first_seen_at', [T, 'us-dv-1']))[0];
  const stored = await pool.query('SELECT device_hash FROM customer_devices WHERE tenant_id=?', [T]);
  assert.ok(stored[0].every(row => /^[0-9a-f]{64}$/.test(row.device_hash)), 'a keyed hash, not the id the cookie carries');
  await pool.query("UPDATE customer_devices SET last_seen_at = DATE_SUB(NOW(), INTERVAL 40 DAY) WHERE tenant_id=? AND user_id=? AND device_hash=?", [T, 'us-dv-1', b.device_hash]);
  const fresh = randomUUID();
  assert.deepEqual(await signIn(T, 'us-dv-1', fresh), { deviceCount: 2, known: false }, 'the lapsed place is taken');
  const left = (await pool.query('SELECT device_hash FROM customer_devices WHERE tenant_id=? AND user_id=?', [T, 'us-dv-1']))[0].map(row => row.device_hash);
  assert.ok(left.includes(a.device_hash), 'the device still in use stays');
  assert.ok(!left.includes(b.device_hash), 'the lapsed one is gone');
  await assert.rejects(signIn(T, 'us-dv-1', randomUUID()), error => error.code === 'DEVICE_LIMIT', 'both are in use again: refused');
  assert.equal(await devices.clearCustomerDevices(pool, { tenantId: T, userId: 'us-dv-1' }), 2, 'support can clear an account\'s places');
  assert.equal(await count(T, 'us-dv-1'), 0);
});

test('a browser with no cookie is given a device id the page cannot read', { skip }, async () => {
  const headers = [];
  const req = { headers: {}, res: { append: (name, value) => headers.push([name, value]) } };
  const id = devices.deviceIdFor(req);
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.match(headers[0][1], /mahadDevice=.*HttpOnly/);
  assert.match(headers[0][1], /Secure/);
  assert.equal(devices.deviceIdFor(req), id, 'the same request gets the same id');
  assert.equal(devices.peekDeviceHash({ headers: {} }), null, 'looking never mints a cookie');
});
