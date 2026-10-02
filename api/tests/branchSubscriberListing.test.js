'use strict';
/**
 * «عدد عملاء الدقي بيظهر 140 وهما أكتر». A branch's clients are asked for by
 * branch, counted by the database, and fetched in pages — and the caller's data
 * scope still applies on top. Runs the real router against a recording pool.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'branch-listing-test-secret-0123456789abcdef';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

const queries = [];
const fakePool = {
  async query(sql, params) {
    queries.push({ sql, params });
    if (/GROUP BY client_status/.test(sql)) return [[{ client_status: '', cnt: 300 }, { client_status: 'finished', cnt: 40 }, { client_status: 'paused', cnt: 5 }]];
    return [[]];
  },
};
const stub = (rel, exports) => {
  const resolved = require.resolve(path.join(__dirname, rel));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};
const real = require('../lib/db');
stub('../lib/db', { ...real, pool: fakePool });
const pass = (_req, _res, next) => next();
const realAuth = require('../middleware/auth');
stub('../middleware/auth', {
  ...realAuth, requireAuth: pass, requireAdminOrStaff: pass,
  requirePermission: () => pass, requireAnyPermission: () => pass,
});
const router = require('../routes/admin/stafflists');

async function call(url, req = {}) {
  queries.length = 0;
  const app = express();
  app.use((request, _res, next) => { request.tenantId = 't1'; Object.assign(request, req); next(); });
  app.use(router);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`);
    return { status: response.status, body: await response.json().catch(() => null) };
  } finally { server.close(); }
}
const admin = { isSuperAdmin: true, staffRecord: null };
const sales = { isSuperAdmin: false, staffRecord: { id: 'rep1', role: 'sales' } };

test('the count is the database\'s, for the branch asked, with the status split', async () => {
  const result = await call('/api/admin/subscribers/count?branch=daqqi', admin);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { total: 345, byStatus: { '': 300, finished: 40, paused: 5 } });
  const { sql, params } = queries[0];
  assert.match(sql, /s\.branch IN \(\?\)/);
  assert.ok(params.includes('DAQQI'), 'normalised to the branch code');
  assert.match(sql, /s\.is_active=1/, 'the population the list holds');
});

test('a branch that is not one matches nothing, rather than everything', async () => {
  await call('/api/admin/subscribers/count?branch=nonsense', admin);
  assert.match(queries[0].sql, /AND 1=0/);
});

test('the caller\'s data scope still applies on top of the branch', async () => {
  await call('/api/admin/subscribers/count?branch=DAQQI', sales);
  const { sql, params } = queries[0];
  assert.match(sql, /s\.assigned_sales_id = \?/);
  assert.match(sql, /s\.branch IN \(\?\)/);
  assert.ok(params.includes('rep1') && params.includes('DAQQI'));
});

test('a role with no client scope is counted as zero without touching the table', async () => {
  const result = await call('/api/admin/subscribers/count?branch=DAQQI', { isSuperAdmin: false, staffRecord: { id: 'h', role: 'hr' } });
  assert.deepEqual(result.body, { total: 0, byStatus: {} });
  assert.equal(queries.length, 0);
});

test('the list takes the same branch filter and pages deterministically', async () => {
  await call('/api/admin/subscribers?branch=DAQQI&limit=300&offset=300', admin);
  const list = queries.find(q => /FROM subscribers s/.test(q.sql) && /LIMIT \? OFFSET \?/.test(q.sql));
  assert.ok(list, 'the list query ran');
  assert.match(list.sql, /s\.branch IN \(\?\)/);
  assert.match(list.sql, /ORDER BY s\.created_at DESC, s\.id DESC/, 'a tie on created_at cannot repeat or skip a row across pages');
  assert.deepEqual(list.params.slice(-3), ['DAQQI', 300, 300]);
});

test('the staff list takes it too', async () => {
  await call('/api/staff/subscribers?branch=DAQQI&limit=300&offset=0', admin);
  const list = queries.find(q => /FROM subscribers s/.test(q.sql) && /LIMIT \? OFFSET \?/.test(q.sql));
  assert.match(list.sql, /s\.branch IN \(\?\)/);
  assert.deepEqual(list.params.slice(-3), ['DAQQI', 300, 0]);
});
