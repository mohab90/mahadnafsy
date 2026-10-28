'use strict';
/**
 * The real app (lib/httpApp.js createHttpApp) on a free port, and members of
 * staff who sign in to it through POST /api/auth/login — for integration tests
 * that drive routes over HTTP with real sessions instead of calling handlers by
 * hand. Needs DB_* and the isolating runner's own database (or a tenant id no
 * other file uses).
 */
const os = require('node:os');
const bcrypt = require('bcryptjs');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';

async function startApp(pool) {
  const { createHttpApp } = require('../../../lib/httpApp');
  const app = createHttpApp({ pool, brandAssetRoot: os.tmpdir() });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    close: () => new Promise(resolve => server.close(resolve)),
    /** { status, body, text } for one request, as `session` (a cookie from signIn) or anonymously. */
    async call(method, path, { session = null, body, tenantId = session?.tenantId, headers = {} } = {}) {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(tenantId ? { 'X-Tenant-Id': tenantId } : {}),
          ...(session ? { Cookie: session.cookie } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { status: res.status, body: json, text };
    },
  };
}

/**
 * A member of staff with a users row and a staff row, signed in over HTTP.
 * `role` is the staff role (ADMIN, SALES, ACCOUNTANT…); `permissions`, when
 * given, replaces the role's defaults the way the permission screen does.
 */
async function signInStaff(pool, app, {
  tenantId = 'tenant-default', id, role = 'ADMIN', name = id, email = `${id}@example.test`,
  password = 'Integration-Pass-2026!', permissions = null, branchId = null, dataScope = null,
}) {
  const hash = await bcrypt.hash(password, 4);
  await pool.query(
    `INSERT INTO users (id, tenant_id, email, password_hash, name, role, is_active, session_version)
     VALUES (?, ?, ?, ?, ?, 'staff', 1, 1)
     ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), is_active=1`,
    [`u-${id}`, tenantId, email, hash, name]);
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, permissions_json, branch_id, data_scope)
     VALUES (?, ?, ?, ?, '1011112222', ?, 1, '2025-01-01', ?, COALESCE(?, 'branch-other'), ?)
     ON DUPLICATE KEY UPDATE role=VALUES(role), permissions_json=VALUES(permissions_json), is_active=1`,
    [id, tenantId, name, email, role, permissions ? JSON.stringify(permissions) : null, branchId, dataScope]);
  const res = await fetch(`${app.base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': tenantId },
    body: JSON.stringify({ email, password }),
  });
  const text = await res.text();
  if (res.status !== 200) throw new Error(`sign-in for ${email} answered ${res.status}: ${text}`);
  const cookie = (res.headers.getSetCookie?.() || []).map(value => value.split(';')[0]).find(value => value.startsWith('authToken='));
  if (!cookie) throw new Error(`sign-in for ${email} set no session cookie`);
  return { cookie, tenantId, staffId: id, userId: `u-${id}`, email, name };
}

/** A customer: a users row, the client record with the same email, signed in over HTTP. */
async function signInCustomer(pool, app, {
  tenantId = 'tenant-default', id, name = id, email = `${id}@example.test`, phone = '01012345678',
  password = 'Integration-Pass-2026!',
}) {
  const hash = await bcrypt.hash(password, 4);
  await pool.query(
    `INSERT INTO users (id, tenant_id, firebase_uid, email, password_hash, name, role, is_active, session_version)
     VALUES (?, ?, ?, ?, ?, ?, 'user', 1, 1)
     ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), is_active=1`,
    [`u-${id}`, tenantId, `u-${id}`, email, hash, name]);
  await pool.query(
    `INSERT INTO subscribers (id, tenant_id, firebase_uid, name, email, phone, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE is_active=1`,
    [id, tenantId, `u-${id}`, name, email, phone]);
  const res = await fetch(`${app.base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': tenantId },
    body: JSON.stringify({ email, password }),
  });
  const text = await res.text();
  if (res.status !== 200) throw new Error(`sign-in for ${email} answered ${res.status}: ${text}`);
  const cookies = (res.headers.getSetCookie?.() || []).map(value => value.split(';')[0]);
  // The session and the device cookie (lib/customerDevices.js) travel together, as in a browser.
  const cookie = cookies.filter(value => !/=$/.test(value)).join('; ');
  if (!/authToken=/.test(cookie)) throw new Error(`sign-in for ${email} set no session cookie`);
  return { cookie, tenantId, subscriberId: id, userId: `u-${id}`, email, name };
}

/** A tenant of the test's own with an active plan, so the admin feature gate lets its staff in. */
async function ensureTenant(pool, tenantId) {
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status, plan_key) VALUES (?, ?, ?, 'active', 'enterprise-local')",
    [tenantId, tenantId, tenantId]);
  await pool.query(
    `INSERT IGNORE INTO tenant_subscriptions (id, tenant_id, plan_id, status, starts_at)
     SELECT ?, ?, id, 'active', UTC_TIMESTAMP() FROM saas_plans WHERE plan_key='enterprise-local' LIMIT 1`,
    [`sub-${tenantId}`, tenantId]);
}

module.exports = { startApp, signInStaff, signInCustomer, ensureTenant };
