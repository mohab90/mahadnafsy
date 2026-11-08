'use strict';

/**
 * Calling an Express route in a unit test — the guards in front of it as they decide, the handler against a database that answers by pattern —
 * so a test asserts what the route DOES (the status, the body, the rows it asked for) and not what its source says.
 *
 *   const { guard, callRoute, fakePool } = require('./support/routes');   // first require of the file: it must run before the routes load
 *   const verdict = await guard(router, 'post', '/api/admin/x', { staff: { role: 'support', permissions: ['a'] } });
 *   // verdict.allowed === true: every guard let the caller through; otherwise { status, body, by }
 *
 * The identity guards (requireAuth, requireAdminOrStaff) look the caller up in the database and a token; the test hands the route an already
 * resolved caller instead, the way the integration tests' call() does. requireAdmin / requireSuperAdmin pass for `superAdmin: true` and refuse
 * everyone else. Every other guard — requirePermission, requireAnyPermission, a rate limiter, a validator — runs for real. MFA is off, as on a
 * tenant that has not turned it on.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-routes-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
// middleware/auth.js takes getMfaPolicy from this module when it loads, so the stub has to be in place before any route is required.
const mfa = require('../../lib/mfaPolicy');
mfa.getMfaPolicy = async () => ({ enabled: false });

const { pool } = require('../../lib/db');

const IDENTITY_GUARDS = new Set(['requireAuth', 'requireAdminOrStaff', 'requireAdminOrOnlineManager', 'requireAdminOrOnlineManagerOrCollection', 'optionalAuth']);
const ADMIN_GUARDS = new Set(['requireAdmin', 'requireSuperAdmin']);

function layerOf(router, method, routePath) {
  const layer = router.stack.find(item => item.route?.path === routePath && item.route.methods[method]);
  if (!layer) throw new Error(`${method.toUpperCase()} ${routePath} is not a route of this router`);
  return layer;
}

function fakeResponse() {
  const res = {
    statusCode: 200, body: null, headers: {}, sent: false,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; this.sent = true; return this; },
    send(payload) { this.body = payload; this.sent = true; return this; },
    set(name, value) { this.headers[String(name).toLowerCase()] = value; return this; },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; return this; },
    getHeader(name) { return this.headers[String(name).toLowerCase()]; },
    type(value) { this.headers['content-type'] = value; return this; },
    end() { this.sent = true; return this; },
  };
  return res;
}

function fakeRequest({ staff = null, superAdmin = false, params = {}, body = {}, query = {}, tenantId = 't-routes', headers = {} } = {}) {
  return {
    params, body, query, headers, tenantId, ip: '127.0.0.1', get: () => undefined, method: 'GET', originalUrl: '/',
    user: { uid: 'u-routes', email: 'caller@example.test' }, staffRecord: staff, isSuperAdmin: superAdmin,
  };
}

/** Runs the guards in front of the route's own handler and says what they decided. */
async function guard(router, method, routePath, caller = {}) {
  const handles = layerOf(router, method, routePath).route.stack.map(entry => entry.handle);
  const req = fakeRequest(caller); const res = fakeResponse();
  for (const handle of handles.slice(0, -1)) {
    if (IDENTITY_GUARDS.has(handle.name)) continue;
    if (ADMIN_GUARDS.has(handle.name)) {
      if (caller.superAdmin) continue;
      return { allowed: false, status: 403, body: { error: 'admin only' }, by: handle.name };
    }
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) return { allowed: false, status: res.statusCode, body: res.body, by: handle.name || 'guard' };
  }
  return { allowed: true };
}

/** The whole route: its guards, then its handler. Resolves { status, body, headers, allowed }. */
async function callRoute(router, method, routePath, caller = {}) {
  const verdict = await guard(router, method, routePath, caller);
  if (!verdict.allowed) return { status: verdict.status, body: verdict.body, headers: {}, allowed: false };
  const handles = layerOf(router, method, routePath).route.stack.map(entry => entry.handle);
  const req = fakeRequest(caller); const res = fakeResponse();
  await handles[handles.length - 1](req, res, () => {});
  return { status: res.statusCode, body: res.body, headers: res.headers, allowed: true };
}

/**
 * Makes lib/db's pool answer by pattern for the length of a test: `answers` is [[pattern, rowsOrFunction]]; the first pattern the
 * whitespace-flattened SQL matches wins; anything else answers no rows. Returns { calls, restore }.
 */
function fakePool(answers) {
  const original = pool.query;
  const calls = [];
  pool.query = async (sql, params = []) => {
    const flat = String(sql).replace(/\s+/g, ' ');
    calls.push({ sql: flat, params });
    for (const [pattern, answer] of answers) {
      if (pattern.test(flat)) return [typeof answer === 'function' ? answer(params, flat) : answer, []];
    }
    return [[], []];
  };
  return { calls, restore() { pool.query = original; } };
}

const staffWith = (...permissions) => ({ id: 'st-routes', name: 'موظف', role: 'custom', is_active: 1, permissions_json: JSON.stringify(permissions) });

module.exports = { guard, callRoute, fakePool, staffWith, fakeRequest, fakeResponse };
