'use strict';
/**
 * Every staff role opens every screen, against a real MariaDB and the real routers (26 Oct 2026).
 *
 * Why this exists: the lecturer's «طلابي» tab answered 500 for every lecturer on the production server, behind more than two thousand green unit
 * tests — most of them read the source for a phrase and none of them ran the SQL. A walk of every parameterless GET under /api/admin, /api/staff,
 * /api/community and /api/me, signed in as each role, found it in seconds, because a query that names a column the table does not have
 * fails the moment it is parsed, with or without data.
 *
 * It fails on:
 *   • any 5xx, from any role — the route broke, whatever the role was allowed to see;
 *   • a 401 or 403 on a route every employee needs for their own page (/api/staff/me…, /api/auth/me).
 * A 403 elsewhere is the permission system doing its job. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-role-walk-it';
process.env.DEFAULT_TENANT_ID = T;
process.env.ADMIN_EMAILS = 'owner@rolewalk.test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
process.env.DISABLE_BACKGROUND_JOBS = 'true';

// Not screens: they stream a file, sign someone out, or reach a third party.
const NOT_A_SCREEN = /logout|export|download|stream|\.csv|\.xlsx|\bsse\b|events$|backup|whatsapp-web\/(connect|qr|state)|ai\/|openapi|server-status|monitoring|\/img$|media\//i;
const SELF_SERVICE = /^\/api\/(staff\/me|auth\/me)/;

let pool; let server; let base; let caller = null;
let roles = [];

function collectGetPaths(router, prefix = '', found = new Set(), seen = new WeakSet()) {
  if (!router || seen.has(router)) return found;
  seen.add(router);
  for (const layer of router.stack || []) {
    if (layer.route) {
      if (layer.route.methods.get && typeof layer.route.path === 'string') found.add(prefix + layer.route.path);
    } else if (layer.handle?.stack) {
      collectGetPaths(layer.handle, prefix, found, seen);
    }
  }
  return found;
}

async function clean() {
  for (const table of ['staff', 'tenant_settings', 'audit_logs', 'audit_chain_heads', 'notifications']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
  await pool.query('DELETE FROM tenants WHERE id=?', [T]).catch(() => {});
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  await pool.query("INSERT INTO tenants (id, slug, name, status) VALUES (?, ?, 'Role walk IT', 'suspended')", [T, T]);
  const { ROLES } = require('../../constants/permissions');
  roles = Object.values(ROLES).filter(role => !['super_admin'].includes(role));
  for (const [index, role] of roles.entries()) {
    await pool.query(
      `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES (?, ?, ?, ?, ?, ?, 1, '2025-01-01')`,
      [`rw-${role}`, T, `موظف ${role}`, `${role}@rolewalk.test`, `10555${String(1000 + index)}`, role.toUpperCase()]);
  }
  // A lecturer's account is the portal's: give the lecturer jobs the profile and the course the portal reads.
  const express = require('express');
  const { registerRoutes, routeModules } = require('../../lib/registerRoutes');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.tenantId = T;
    if (caller) req.user = { uid: `u-${caller}`, email: `${caller}@rolewalk.test`, tenant_id: T, is_staff: true, mfa_verified: true };
    next();
  });
  registerRoutes(app);
  const paths = new Set();
  for (const [, modulePath] of routeModules) collectGetPaths(require(require('node:path').resolve(__dirname, '../../lib', modulePath)), '', paths);
  app.locals.paths = [...paths]
    .filter(path => /^\/api\/(admin|staff|community|me|auth\/me|notifications)/.test(path) && !/[:*()]/.test(path) && !NOT_A_SCREEN.test(path))
    .sort();
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  paths.clear();
  server.paths = app.locals.paths;
});

after(async () => {
  if (!ENABLED) return;
  if (server) await new Promise(resolve => server.close(resolve));
  await clean();
  await pool.end();
  setTimeout(() => process.exit(), 300).unref();
});

test('no role gets a 5xx from any screen, and every role opens its own staff page', { skip, timeout: 25 * 60 * 1000 }, async () => {
  assert.ok(server.paths.length > 150, `found ${server.paths.length} parameterless screens — the route walk is broken`);
  const broken = new Map();
  const refusedSelfService = [];
  for (const role of roles) {
    caller = role;
    const queue = [...server.paths];
    const worker = async () => {
      for (let path = queue.shift(); path; path = queue.shift()) {
        let status = 0; let text = '';
        try {
          const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(30000) });
          status = response.status;
          if (status >= 400) text = (await response.text()).slice(0, 140);
        } catch (error) { status = -1; text = error.message; }
        if (status >= 500 || status === -1) {
          const key = `${path} → ${status} ${text}`;
          broken.set(key, [...(broken.get(key) || []), role]);
        } else if ((status === 401 || status === 403) && SELF_SERVICE.test(path) && !/whatsapp-channel/.test(path)) {
          refusedSelfService.push(`${role} ${path} → ${status}`);
        }
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
  }
  const report = [...broken.entries()].map(([key, who]) => `${key}  [${who.length} role(s): ${who.slice(0, 4).join(', ')}]`);
  assert.deepEqual(report, [], `screens that answered 5xx:\n${report.join('\n')}`);
  assert.deepEqual(refusedSelfService, [], `an employee is refused their own page:\n${refusedSelfService.join('\n')}`);
});
