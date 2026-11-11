'use strict';
// Runs a real express route — its whole middleware chain (requireAuth, requireAdminOrStaff, requirePermission …) and its handler — without
// a database and without a socket. The database is a recording stub; the staff lookup the guards make is answered from `staff`, so what a
// test varies is who is calling (no token, an account with no permission, the owner) and what the tables answer, and what it reads back is
// the status, the body and every statement the route sent with its parameters.
//
// Use: call install() BEFORE requiring any route module (the stub replaces lib/db in the require cache), then run(router, ...).
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-route-harness-secret-0123456789-abcdefghijklmnop';

const TENANT = 'tenant-default';

function stubModule(rel, exports) {
  const file = require.resolve(path.join(__dirname, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

/**
 * @param {{answer?: (sql: string, params: any[]) => any}} options
 *   answer — what a table returns: an array is the rows; undefined is a write that touched one row; a thrown error is a database error.
 * @returns {{calls: {sql: string, params: any[]}[], state: {staff: object|null, answer: Function}, pool: object}}
 */
function install({ answer } = {}) {
  const calls = [];
  const state = { staff: null, answer: answer || (() => undefined), transactions: [] };
  const record = async (sql, params = []) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    // The guards' own lookup of who is calling.
    if (/FROM staff WHERE tenant_id = \? AND LOWER\(TRIM\(email\)\)/.test(text)) return [state.staff ? [state.staff] : []];
    calls.push({ sql: text, params });
    const rows = await state.answer(text, params);
    if (rows === undefined) return /^\(?\s*SELECT/i.test(text) ? [[]] : [{ affectedRows: 1, insertId: 0 }];
    return [rows];
  };
  const connection = {
    query: record, execute: record,
    beginTransaction: async () => { state.transactions.push('begin'); },
    commit: async () => { state.transactions.push('commit'); },
    rollback: async () => { state.transactions.push('rollback'); },
    release() { state.transactions.push('release'); },
  };
  const pool = { query: record, execute: record, getConnection: async () => connection };
  stubModule('../lib/db', {
    pool, cached: async (_key, _ttl, fn) => fn(), cacheInvalidate() {}, cacheInvalidateLocal() {}, requireDb: (_q, _s, next) => next(),
    isDbDown: () => false, getStaffIdByEmail: async () => null, dbQuery: record, dbExecute: record, clockContract: {},
  });
  // No MFA in these tests: the policy has its own tests.
  const mfa = require('../lib/mfaPolicy');
  mfa.getMfaPolicy = async () => ({ enabled: false });
  return { calls, state, pool, connection };
}

function fakeResponse(done) {
  const res = {
    statusCode: 200, body: null, headers: {}, sent: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.sent = true; done(); return this; },
    send(body) { this.body = body; this.sent = true; done(); return this; },
    end() { this.sent = true; done(); return this; },
    set(name, value) { this.headers[String(name).toLowerCase()] = value; return this; },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; return this; },
    header(name, value) { return this.set(name, value); },
    type() { return this; },
    cookie() { return this; },
    redirect(url) { this.statusCode = 302; this.body = { redirect: url }; this.sent = true; done(); return this; },
  };
  return res;
}

/**
 * Runs one route. `path` is the pattern the route was declared with (e.g. '/api/admin/payments/:id'); give the values in `params`.
 * `as` is the caller: 'anonymous' (no token), 'client' (signed in, no staff row), 'owner', or a staff row {id, role, permissions_json, data_scope}.
 */
async function run(router, method, routePath, { as = 'anonymous', body, query = {}, params = {}, harness, headers = {}, tenantId = TENANT } = {}) {
  const layer = router.stack.find(l => l.route && [].concat(l.route.path).includes(routePath) && l.route.methods[method.toLowerCase()]);
  if (!layer) throw new Error(`no ${method} ${routePath} on this router`);
  const req = {
    method: method.toUpperCase(), originalUrl: routePath, url: routePath, path: routePath, baseUrl: '', params, query, body, headers: { ...headers },
    tenantId, ip: '203.0.113.9', socket: {}, connection: {},
    get(name) { return this.headers[String(name).toLowerCase()]; },
    header(name) { return this.get(name); },
    app: { get: () => undefined, locals: {} },
  };
  if (as === 'client') req.user = { uid: 'u-client', email: 'client@unit.test', tenant_id: tenantId };
  else if (as === 'owner') {
    req.user = { uid: 'u-owner', email: (process.env.ADMIN_EMAILS || '').split(',')[0].trim() || 'owner@unit.test', tenant_id: tenantId };
  } else if (as !== 'anonymous') {
    req.user = { uid: `u-${as.id}`, email: `${as.id}@unit.test`, tenant_id: tenantId };
    if (harness) harness.state.staff = { data_scope: null, permissions_json: '[]', tenant_id: tenantId, ...as };
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; setImmediate(() => resolve(res)); } };
    const res = fakeResponse(finish);
    const stack = layer.route.stack;
    let index = 0;
    const next = err => {
      if (err) { if (!settled) { settled = true; reject(err); } return undefined; }
      const handler = stack[index++];
      if (!handler) { finish(); return undefined; }
      try {
        const out = handler.handle(req, res, next);
        if (out && typeof out.then === 'function') out.catch(e => { if (!settled) { settled = true; reject(e); } });
      } catch (e) { if (!settled) { settled = true; reject(e); } }
      return undefined;
    };
    next();
  }).then(res => ({ status: res.statusCode, body: res.body, headers: res.headers, req }));
}

module.exports = { install, run, TENANT };
