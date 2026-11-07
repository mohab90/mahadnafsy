'use strict';
/**
 * 5 Nov 2026: GET /api/admin/bootstrap answers in one request what the admin panel used to ask 22 routes for at start-up. Against a real MariaDB and the real routers:
 * for each account, every piece is what its own route answers to that same account, and a piece the account may not read is null exactly where the route itself
 * refuses (403) — the bootstrap lends nobody a permission. And the list of paths the panel looks for in the answer is the list the server gives. Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-admin-bootstrap-it';
const PERIOD = '2026-11';
let pool, server, base, caller;

const accounts = {
  full: { uid: 'ab-full', email: 'ab-full@x.t', name: 'مدير' },
  accountant: { uid: 'ab-acc', email: 'ab-acc@x.t', name: 'محاسب' },
  nobody: { uid: 'ab-none', email: 'ab-none@x.t', name: 'ليس موظفا' },
};

const clean = async () => {
  for (const table of ['staff', 'courses', 'bundles', 'therapists']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
};
async function get(url) {
  const response = await fetch(`${base}${url}`);
  const text = await response.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* not json */ }
  return { status: response.status, body };
}
const as = who => { caller = accounts[who]; };
const plain = value => JSON.parse(JSON.stringify(value));

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, permissions_json) VALUES
       ('ab-s1', ?, 'مدير', ?, '01011110001', 'ADMIN', 1, '2025-01-01', ?),
       ('ab-s2', ?, 'محاسب', ?, '01011110002', 'ACCOUNTANT', 1, '2025-01-01', ?)`,
    [T, accounts.full.email, JSON.stringify([]), T, accounts.accountant.email, JSON.stringify(['view_financial'])]);
  await pool.query(
    `INSERT INTO courses (id, tenant_id, slug, title, description, short_description, instructor, thumbnail, category, type, price_egp, is_published)
     VALUES ('ab-c1', ?, 'ab-c1-it', 'كورس', '', '', '', '', 'GENERAL', 'RECORDED', 1000, 1)`, [T]);
  await pool.query("INSERT INTO bundles (id, tenant_id, title, description, price_egp, is_published) VALUES ('ab-b1', ?, 'مسار', '', 1500, 1)", [T]);
  await pool.query("INSERT INTO therapists (id, tenant_id, name, specialty, image, price_egp, is_consultation_enabled, is_active, sort_order) VALUES ('ab-t1', ?, 'د. أحمد', 'علاج', '', 400, 1, 1, 1)", [T]);

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.tenantId = T;
    if (caller) req.user = { ...caller, tenant_id: T, is_staff: true, mfa_verified: true, session_id: 's' };
    next();
  });
  for (const mod of ['admin-bootstrap', 'staff', 'config', 'core/staffacct', 'admin/catalog', 'core/catalog', 'community', 'inbox', 'public', 'staff-announcements', 'notifications', 'payment-proofs', 'analytics/sales', 'hr/staffprofile', 'admin/leads/stats', 'admin/stafflists', 'analytics/dashboard']) {
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

const bootstrap = async (set = 'core') => get(`/api/admin/bootstrap?set=${set}&period=${PERIOD}`);

test('for an account with every permission each piece is what its own route answers', { skip }, async () => {
  as('full');
  const boot = await bootstrap();
  assert.equal(boot.status, 200, JSON.stringify(boot.body));
  const keys = Object.keys(boot.body.pieces);
  assert.equal(keys.length, 19, 'eighteen start-up routes and the month\'s sales targets');
  for (const key of keys) {
    const own = await get(`/api${key}`);
    assert.equal(own.status, 200, `${key} answers for this account`);
    assert.deepEqual(plain(boot.body.pieces[key]), plain(own.body), key);
  }
  assert.equal(boot.body.pieces['/admin/courses?limit=500'].some(row => row.id === 'ab-c1'), true, 'the course made for the test is in the list');
});

test('the overview page figures are a second request of the same kind, and equal their own routes', { skip }, async () => {
  as('full');
  const boot = await bootstrap('overview');
  assert.equal(boot.status, 200, JSON.stringify(boot.body));
  const keys = Object.keys(boot.body.pieces);
  assert.equal(keys.length, 5);
  for (const key of keys) {
    const own = await get(`/api${key}`);
    assert.equal(own.status, 200, key);
    assert.deepEqual(plain(boot.body.pieces[key]), plain(own.body), key);
  }
  as('accountant');
  const refused = await bootstrap('overview');
  for (const key of Object.keys(refused.body.pieces)) assert.equal((await get(`/api${key}`)).status >= 400, refused.body.pieces[key] === null, key);
});

test('an account that may read only the receipts gets only those pieces: null exactly where its own route refuses', { skip }, async () => {
  as('accountant');
  const boot = await bootstrap();
  assert.equal(boot.status, 200);
  const keys = Object.keys(boot.body.pieces);
  let refused = 0;
  for (const key of keys) {
    const own = await get(`/api${key}`);
    if (own.status >= 400) {
      refused += 1;
      assert.equal(boot.body.pieces[key], null, `${key} is refused to this account (${own.status}) and so is null`);
    } else {
      assert.deepEqual(plain(boot.body.pieces[key]), plain(own.body), key);
    }
  }
  assert.ok(refused >= 8, `most of the panel's data is refused to a cashier; ${refused} pieces were`);
  for (const key of ['/admin/staff', '/admin/courses?limit=500', '/admin/therapists', '/admin/content', '/admin/community/posts']) {
    assert.equal(boot.body.pieces[key], null, `${key}: no permission for it`);
  }
  assert.notEqual(boot.body.pieces['/admin/payment-proofs?status=PENDING'], null, 'view_financial opens the receipts');
});

test('a signed-in account that is not staff is given only what its own routes give anybody, and a signed-out request is refused', { skip }, async () => {
  as('nobody');
  for (const set of ['core', 'overview']) {
    const boot = await bootstrap(set);
    assert.equal(boot.status, 200);
    assert.ok(Object.keys(boot.body.pieces).length > 0);
    // the community lists and the branches are public routes and answer anybody; every other piece is null where its own route says no, and what the
    // announcements route says to anybody who is not staff («nothing for you») is all it is given
    for (const [key, piece] of Object.entries(boot.body.pieces)) {
      const own = await get(`/api${key}`);
      if (own.status >= 400) assert.equal(piece, null, `${set} ${key}`);
      else assert.deepEqual(plain(piece), plain(own.body), `${set} ${key}`);
    }
    for (const key of ['/admin/staff', '/admin/courses?limit=500', '/admin/content', '/admin/payment-proofs?status=PENDING', '/admin/leads/stats', '/admin/overview/revenue']) {
      if (key in boot.body.pieces) assert.equal(boot.body.pieces[key], null, key);
    }
  }
  caller = null;
  assert.equal((await bootstrap()).status, 401);
});

test('a bad or missing month leaves out the sales targets and nothing else', { skip }, async () => {
  as('full');
  for (const period of ['', '2026-13', 'abc', "2026-11' OR 1=1"]) {
    const boot = await get(`/api/admin/bootstrap?period=${encodeURIComponent(period)}`);
    assert.equal(boot.status, 200);
    assert.equal(Object.keys(boot.body.pieces).length, 18, `period «${period}»`);
    assert.equal(Object.keys(boot.body.pieces).some(key => key.startsWith('/admin/sales-targets')), false);
  }
});

test('the paths the panel looks for are exactly the ones the server answers', { skip }, async () => {
  const client = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'admin', 'lib', 'mysqlapi.ts'), 'utf8');
  const listed = name => {
    const from = client.indexOf(`const ${name} = [`);
    assert.ok(from >= 0, `the panel names ${name}`);
    const block = client.slice(from, client.indexOf('];', from));
    return [...block.matchAll(/'([^']+)'/g)].map(match => match[1]).sort();
  };
  const { PIECE_PATHS } = require('../../routes/admin-bootstrap');
  assert.deepEqual(listed('BOOTSTRAP_CORE'), PIECE_PATHS('core', null).sort());
  assert.deepEqual(listed('BOOTSTRAP_OVERVIEW'), PIECE_PATHS('overview').sort());
  assert.ok(client.includes("startsWith('/admin/sales-targets?period=')"), 'and the targets of the month');
});
