'use strict';
/**
 * 7 Nov 2026: GET /api/admin/bootstrap?set=accounting[&branch=daqqi|tagamoa] and ?set=dokki answer in one request what the accounts screens and «إحصائيات الدقي» used to
 * ask nine routes for. Against a real MariaDB and the real routers, as adminBootstrap.integration.test.js does for the start-up: for every account each piece is what its
 * own route answers to that same account, a piece the account may not read is null exactly where the route refuses it (the bootstrap lends nobody a permission), and the
 * paths the panel looks for (admin/lib/bootstrapPaths.ts, bundled with esbuild) are the paths the server answers. Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-bootstrap-accounts-it';
const ROOT = path.join(__dirname, '..', '..', '..');
let pool, server, base, caller;

const accounts = {
  full: { uid: 'bk-full', email: 'bk-full@x.t', name: 'مدير' },
  cashier: { uid: 'bk-cash', email: 'bk-cash@x.t', name: 'كاشير' },
  rep: { uid: 'bk-rep', email: 'bk-rep@x.t', name: 'مندوب' },
};
const clean = async () => { for (const table of ['payments', 'expenses', 'subscribers', 'staff']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {}); };
async function get(url) {
  const response = await fetch(`${base}${url}`);
  const text = await response.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* not json */ }
  return { status: response.status, body };
}
// What a route answers twice a moment apart differs only in the moments it names; they are not what is compared.
const plain = value => JSON.parse(JSON.stringify(value, (key, item) => (/^(generatedAt|generated_at|asOf|at|time|now)$/i.test(key) ? undefined : item)));

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, permissions_json) VALUES
       ('bk-s1', ?, 'مدير', ?, '01011110011', 'ADMIN', 1, '2025-01-01', ?),
       ('bk-s2', ?, 'كاشير', ?, '01011110012', 'ACCOUNTANT', 1, '2025-01-01', ?),
       ('bk-s3', ?, 'مندوب', ?, '01011110013', 'SALES', 1, '2025-01-01', ?)`,
    [T, accounts.full.email, JSON.stringify([]), T, accounts.cashier.email, JSON.stringify(['view_financial']), T, accounts.rep.email, JSON.stringify(['view_leads'])]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, client_code, name, phone) VALUES ('bk-sub', ?, 'BK1', 'هبة', '1017770099')", [T]);
  await pool.query("INSERT INTO payments (id, tenant_id, subscriber_id, amount, amount_egp, currency, payment_type, payment_method, status, date) VALUES ('bk-p1', ?, 'bk-sub', 500, 500, 'EGP', 'COURSE', 'CASH', 'paid', NOW())", [T]);
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.tenantId = T;
    if (caller) req.user = { ...caller, tenant_id: T, is_staff: true, mfa_verified: true, session_id: 's' };
    next();
  });
  for (const mod of ['admin-bootstrap', 'subscriber-payments', 'misc/receiptGaps', 'admin/stafflists', 'admin-operations', 'payment-proofs', 'finance-payments-register', 'analytics/financial',
    'finance/budgets', 'payments', 'admin/dokkiclients', 'daqqi-rounds', 'dokkiReports', 'management-reports', 'config', 'admin/analyticssummary']) {
    app.use(require(`../../routes/${mod}`));
  }
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (!ENABLED) return;
  if (server) await new Promise(resolve => server.close(resolve));
  await clean();
  await pool.end();
  setTimeout(() => process.exit(), 300).unref();
});

const SETS = [['accounting', ''], ['accounting', '&branch=daqqi'], ['accounting', '&branch=tagamoa'], ['dokki', '']];
const bootstrap = (set, branch) => get(`/api/admin/bootstrap?set=${set}${branch}`);

test('for the manager each piece is what its own route answers', { skip }, async () => {
  caller = accounts.full;
  for (const [set, branch] of SETS) {
    const boot = await bootstrap(set, branch);
    assert.equal(boot.status, 200, JSON.stringify(boot.body));
    let answered = 0;
    for (const [key, piece] of Object.entries(boot.body.pieces)) {
      const own = await get(`/api${key}`);
      if (own.status >= 400) { assert.equal(piece, null, `${set}${branch} ${key} is refused by its own route (${own.status}) and so is null`); continue; }
      answered += 1;
      assert.deepEqual(plain(piece), plain(own.body), `${set}${branch} ${key}`);
    }
    assert.ok(answered >= 6, `${set}${branch}: most of the pieces answer for a manager (${answered})`);
  }
});

test('a cashier and a rep are lent nothing: null exactly where each route\'s own door says no', { skip }, async () => {
  for (const who of ['cashier', 'rep']) {
    caller = accounts[who];
    let refused = 0;
    for (const [set, branch] of SETS) {
      const boot = await bootstrap(set, branch);
      assert.equal(boot.status, 200);
      for (const [key, piece] of Object.entries(boot.body.pieces)) {
        const own = await get(`/api${key}`);
        if (own.status >= 400) { refused += 1; assert.equal(piece, null, `${who} ${set}${branch} ${key} (${own.status})`); } else assert.deepEqual(plain(piece), plain(own.body), `${who} ${set}${branch} ${key}`);
      }
    }
    if (who === 'rep') assert.ok(refused >= 20, `a sales rep may read little of the books; ${refused} pieces were refused`);
  }
});

test('the paths the panel looks for are exactly the ones the server answers, and a branch is only daqqi or tagamoa', { skip }, async () => {
  const esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild'));
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'admin/lib/bootstrapPaths.ts')], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
    nodePaths: [path.join(ROOT, 'admin', 'node_modules')], define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  const { accountingPaths, dokkiStatsPaths, screenSetOf } = module.exports;
  const { PIECE_PATHS } = require('../../routes/admin-bootstrap');
  assert.deepEqual([...accountingPaths('')].sort(), PIECE_PATHS('accounting', null, null).sort());
  assert.deepEqual([...accountingPaths('daqqi')].sort(), PIECE_PATHS('accounting', null, 'daqqi').sort());
  assert.deepEqual([...accountingPaths('tagamoa')].sort(), PIECE_PATHS('accounting', null, 'tagamoa').sort());
  assert.deepEqual([...dokkiStatsPaths()].sort(), PIECE_PATHS('dokki').sort());
  // a path is served from a set on its own screen only
  assert.equal(screenSetOf('/admin/receipts/gaps', '/dashboard/financial/overview'), 'accounting:');
  assert.equal(screenSetOf('/admin/receipts/gaps', '/dashboard/daqqi_accounting/boxes'), 'accounting:daqqi');
  assert.equal(screenSetOf('/admin/receipts/gaps', '/dashboard/leads'), null);
  assert.equal(screenSetOf('/admin/join-us/counts', '/dashboard/ask_ai'), null, 'the AI screen asks that route for itself');
  assert.equal(screenSetOf('/admin/join-us/counts', '/dashboard/daqqi_stats'), 'dokki');
  caller = accounts.full;
  const odd = await get('/api/admin/bootstrap?set=accounting&branch=nowhere');
  assert.equal(odd.status, 200);
  assert.equal(Object.keys(odd.body.pieces).length, 7, 'an unknown branch is no branch: the books\' own set');
});
