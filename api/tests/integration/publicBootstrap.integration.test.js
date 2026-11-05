'use strict';
/**
 * 5 Nov 2026: GET /api/public/bootstrap answers in one request what the site used to ask seven routes for (texts, courses, tracks, therapists, testimonials, prices,
 * payment availability). Against a real MariaDB: each piece is byte for byte what its own route answers, a piece that fails is null and does not take the others down,
 * and it is public and cached for 30 seconds. Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-public-bootstrap-it';
let pool, publicRouter, pricingRouter, ordersRouter;

async function clean() {
  for (const table of ['testimonials', 'therapist_slots', 'therapists', 'bundle_courses', 'bundles', 'courses']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}
// Calls the last handler of a route (the guards before it are the rate limiter) with a request that carries the tenant and the query.
async function call(router, path, query = {}) {
  const layer = router.stack.find(entry => entry.route?.path === path && entry.route.methods.get);
  const res = { statusCode: 200, body: undefined, headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await layer.route.stack.at(-1).handle({ params: {}, query, body: {}, headers: {}, tenantId: T, ip: '1', get: () => undefined }, res);
  return res;
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  publicRouter = require('../../routes/public');
  pricingRouter = require('../../routes/public-pricing');
  ordersRouter = require('../../routes/public-orders');
  await clean();
  await pool.query(
    `INSERT INTO courses (id, tenant_id, slug, title, description, short_description, instructor, thumbnail, category, type, price_egp, price_sar, is_published)
     VALUES ('pb-c1', ?, 'pb-c1-it', 'كورس أول', 'وصف', 'مختصر', 'م', '', 'GENERAL', 'RECORDED', 3000, 600, 1), ('pb-c2', ?, 'pb-c2-it', 'كورس تاني', '', '', '', '', 'GENERAL', 'RECORDED', 2000, 0, 1)`, [T, T]);
  await pool.query("INSERT INTO bundles (id, tenant_id, title, description, price_egp, is_published) VALUES ('pb-b1', ?, 'مسار', '', 4500, 1)", [T]);
  await pool.query("INSERT INTO bundle_courses (tenant_id, bundle_id, course_id, sort_order) VALUES (?, 'pb-b1', 'pb-c1', 1), (?, 'pb-b1', 'pb-c2', 2)", [T, T]);
  await pool.query("INSERT INTO testimonials (id, tenant_id, name, role, text, image, sort_order, is_active) VALUES ('pb-t1', ?, 'منى', 'طالبة', 'ممتاز', '', 1, 1)", [T]);
  await pool.query("INSERT INTO therapists (id, tenant_id, name, specialty, image, price_egp, is_consultation_enabled, is_active, sort_order) VALUES ('pb-th1', ?, 'د. أحمد', 'علاج نفسي', '', 500, 1, 1, 1)", [T]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('every piece of the bootstrap is what its own route answers', { skip }, async () => {
  const boot = await call(publicRouter, '/api/public/bootstrap');
  assert.equal(boot.statusCode, 200);
  const single = {
    content: (await call(publicRouter, '/api/content')).body,
    courses: (await call(publicRouter, '/api/courses', { limit: '200', offset: '0' })).body,
    bundles: (await call(publicRouter, '/api/bundles', { limit: '100' })).body,
    therapists: (await call(publicRouter, '/api/therapists', { limit: '100' })).body,
    testimonials: (await call(publicRouter, '/api/testimonials')).body,
    prices: (await call(pricingRouter, '/api/public/prices')).body,
    paymentAvailability: (await call(ordersRouter, '/api/public/payment-availability')).body,
  };
  for (const [name, expected] of Object.entries(single)) {
    assert.ok(expected !== undefined && expected !== null, `${name}: its own route answered`);
    assert.equal(JSON.stringify(boot.body[name]), JSON.stringify(expected), `${name}: the bootstrap's piece is the route's answer`);
  }
  assert.deepEqual(Object.keys(boot.body).sort(), Object.keys(single).sort(), 'and nothing else is in it');
});

test('the seeded catalogue really is in it (the comparison above is not of two empty answers)', { skip }, async () => {
  const { body } = await call(publicRouter, '/api/public/bootstrap');
  assert.deepEqual(body.courses.map(course => course.id).sort(), ['pb-c1', 'pb-c2']);
  assert.deepEqual(body.bundles.map(bundle => bundle.id), ['pb-b1']);
  assert.equal(body.testimonials[0].name, 'منى');
  assert.equal(body.therapists[0].name, 'د. أحمد');
  assert.ok(body.prices.items['course:pb-c1'].EGP.price > 0, 'a price for a published course');
  assert.equal(typeof body.paymentAvailability.online, 'boolean');
});

test('it is public and cached for the texts\' 30 seconds', { skip }, async () => {
  const res = await call(publicRouter, '/api/public/bootstrap');
  assert.match(res.headers['Cache-Control'], /public, max-age=30/);
});

test('a piece that fails is null and the others are still answered', { skip }, async () => {
  const original = pool.query.bind(pool);
  // the therapists lookup fails; everything else is untouched
  pool.query = (sql, ...rest) => (/FROM therapists WHERE is_active = 1/.test(String(sql)) ? Promise.reject(new Error('boom')) : original(sql, ...rest));
  try {
    const { cacheInvalidate } = require('../../lib/db');
    for (const key of [`therapists:${T}:100`]) cacheInvalidate?.(key);
    const res = await call(publicRouter, '/api/public/bootstrap');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.therapists, null);
    assert.equal(res.body.courses.length, 2, 'the courses are still there');
    assert.equal(res.body.bundles.length, 1);
  } finally { pool.query = original; }
});

// ── isStaff on /api/auth/me, so the site does not ask /api/me/is-staff on every page ───────────────────────────────────────────────────────────────────────────
async function asUser(router, path, user, query = {}) {
  const layer = router.stack.find(entry => entry.route?.path === path && entry.route.methods.get);
  const res = { statusCode: 200, body: undefined, headers: {}, set() { return this; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await layer.route.stack.at(-1).handle({ params: {}, query, body: {}, headers: {}, tenantId: T, ip: '1', user: { uid: user.id, email: user.email, session_id: 's' }, get: () => undefined }, res);
  return res;
}

test('auth/me says isStaff on request, by the rule /api/me/is-staff uses, and says nothing without the request', { skip }, async () => {
  const authRouter = require('../../routes/auth/session');
  const profileRouter = require('../../routes/profile');
  await pool.query('DELETE FROM staff WHERE tenant_id=?', [T]).catch(() => {});
  await pool.query('DELETE FROM users WHERE tenant_id=?', [T]).catch(() => {});
  const users = [
    { id: 'pb-u-customer', email: 'pb-customer@x.t' },
    { id: 'pb-u-staff', email: 'pb-staff@x.t' },
    { id: 'pb-u-gone', email: 'pb-gone@x.t' },
  ];
  for (const [index, user] of users.entries()) await pool.query("INSERT INTO users (id, tenant_id, email, phone, name, password_hash) VALUES (?, ?, ?, ?, 'م', 'x')", [user.id, T, user.email, `10196000${index}1`]);
  await pool.query("INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES ('pb-st-1', ?, 'موظف', 'pb-staff@x.t', '1019600091', 'SALES', 1, '2025-01-01'), ('pb-st-2', ?, 'سابق', 'pb-gone@x.t', '1019600092', 'SALES', 0, '2025-01-01')", [T, T]);
  try {
    const expected = { 'pb-u-customer': false, 'pb-u-staff': true, 'pb-u-gone': false };
    for (const user of users) {
      const me = await asUser(authRouter, '/api/auth/me', user, { include: 'isStaff' });
      const isStaff = await asUser(profileRouter, '/api/me/is-staff', user);
      assert.equal(me.statusCode, 200, JSON.stringify(me.body));
      assert.equal(me.body.isStaff, expected[user.id], `${user.id} by auth/me`);
      assert.equal(me.body.isStaff, isStaff.body.isStaff, `${user.id}: auth/me and is-staff agree`);
      assert.equal('isStaff' in (await asUser(authRouter, '/api/auth/me', user)).body, false, `${user.id}: not asked, not answered`);
    }
  } finally {
    await pool.query('DELETE FROM staff WHERE tenant_id=?', [T]).catch(() => {});
    await pool.query('DELETE FROM users WHERE tenant_id=?', [T]).catch(() => {});
  }
});
