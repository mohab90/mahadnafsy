'use strict';
/**
 * The certificates desk («شهادات المعهد») as it behaves, on a real MariaDB (these were regular expressions over routes/instituteCertificates.js, routes/lms.js and
 * migration 302/307): a certificate is added from a client and a course or track — refused with «PAYMENT_SHORT» when 90% is not paid, unless the desk forces it — and asking
 * again opens the one that exists; printing records who and when and moves a READY certificate to PRINTED; the delivery stage is one of the known ones; the form layout
 * is measured in cm within the sheet; a wrong certificate is revoked first and then deleted softly, and a deleted one is off the desk's list and cannot be printed.
 * Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-certdesk-it';
let pool; let desk; let lms;

async function call(router, method, path, { params = {}, body = {} } = {}) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `${method} ${path}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params, body, query: {}, headers: {}, tenantId: T, user: { uid: 'u', email: 'owner@example.test' }, staffRecord: null, isSuperAdmin: true, ip: '127.0.0.1', get: () => undefined };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff', 'requireAdmin'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

async function clean() {
  for (const table of ['client_history', 'activity_logs', 'course_completions', 'enrollments', 'payments', 'subscribers', 'courses', 'tenant_settings', 'outbox']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}
const add = (subscriberId, extra = {}) => call(desk, 'post', '/api/admin/institute-certificates', { body: { subscriberId, courseId: 'co-cd-1', ...extra } });
const rowOf = async id => (await pool.query('SELECT status, delivery_status, print_count, printed_by, deleted_at FROM course_completions WHERE id=?', [id]))[0][0];

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  desk = require('../../routes/instituteCertificates');
  lms = require('../../routes/lms');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, title_en, description, short_description, instructor, thumbnail, category, type, price_egp)
     VALUES ('co-cd-1', ?, 'دبلومة', 'Diploma', '', '', '', '', 'GENERAL', 'RECORDED', 3000)`, [T]);
  for (const [id, phone] of [['sub-cd-paid', '01019600011'], ['sub-cd-short', '01019600012']]) {
    await pool.query("INSERT INTO subscribers (id, tenant_id, name, name_en, phone, branch, branch_id) VALUES (?, ?, 'عميل كامل الاسم', 'Full Name', ?, 'ONLINE_EGYPT', 'branch-online-egypt')", [id, T, phone]);
  }
  await pool.query("INSERT INTO payments (id, tenant_id, subscriber_id, course_id, amount, amount_egp, currency, status, payment_type, course_expected, date) VALUES ('p-cd-1', ?, 'sub-cd-paid', 'co-cd-1', 3000, 3000, 'EGP', 'paid', 'COURSE', 3000, NOW())", [T]);
  await pool.query("INSERT INTO payments (id, tenant_id, subscriber_id, course_id, amount, amount_egp, currency, status, payment_type, course_expected, date) VALUES ('p-cd-2', ?, 'sub-cd-short', 'co-cd-1', 300, 300, 'EGP', 'paid', 'COURSE', 3000, NOW())", [T]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('a certificate is added for a client who paid 90%; a short payer is refused unless the desk forces it; asking again opens the same one', { skip }, async () => {
  assert.equal((await call(desk, 'post', '/api/admin/institute-certificates', { body: { subscriberId: 'sub-cd-paid' } })).statusCode, 400, 'a course or a track is named');
  const made = await add('sub-cd-paid');
  assert.equal(made.statusCode, 200, JSON.stringify(made.body));
  assert.ok(made.body.code && made.body.id);
  assert.equal(made.body.alreadyHad, false);
  const again = await add('sub-cd-paid');
  assert.equal(again.body.id, made.body.id, 'the same certificate');
  assert.equal(again.body.alreadyHad, true);
  const short = await add('sub-cd-short');
  assert.equal(short.statusCode, 409);
  assert.equal(short.body.code, 'PAYMENT_SHORT');
  const forced = await add('sub-cd-short', { force: true });
  assert.equal(forced.statusCode, 200, JSON.stringify(forced.body));
  const list = await call(desk, 'get', '/api/admin/institute-certificates');
  assert.deepEqual(list.body.map(item => item.subscriberId).sort(), ['sub-cd-paid', 'sub-cd-short']);
});

test('printing records who and when and moves a READY certificate on; the delivery stage is one of the known ones', { skip }, async () => {
  const [[cert]] = await pool.query("SELECT id FROM course_completions WHERE tenant_id=? AND subscriber_id='sub-cd-paid'", [T]);
  assert.equal((await rowOf(cert.id)).delivery_status, 'READY');
  assert.equal((await call(desk, 'post', '/api/admin/institute-certificates/:id/printed', { params: { id: cert.id }, body: { mode: 'form' } })).statusCode, 200);
  assert.equal((await call(desk, 'post', '/api/admin/institute-certificates/:id/printed', { params: { id: cert.id }, body: {} })).statusCode, 200);
  const printed = await rowOf(cert.id);
  assert.deepEqual([printed.delivery_status, Number(printed.print_count), !!printed.printed_by], ['PRINTED', 2, true]);
  assert.equal((await call(desk, 'post', '/api/admin/institute-certificates/:id/printed', { params: { id: 'nope' }, body: {} })).statusCode, 404);
  assert.equal((await call(desk, 'patch', '/api/admin/institute-certificates/:id/status', { params: { id: cert.id }, body: { status: 'LOST' } })).statusCode, 400);
  assert.equal((await call(desk, 'patch', '/api/admin/institute-certificates/:id/status', { params: { id: cert.id }, body: { status: 'shipped' } })).statusCode, 200);
  assert.equal((await rowOf(cert.id)).delivery_status, 'SHIPPED');
});

test('the form layout is measured in cm within the sheet, and what is saved comes back', { skip }, async () => {
  const bad = await call(desk, 'put', '/api/admin/institute-certificates/layout', { body: { nameTop: 2, courseTop: 10, hoursTop: 12, codeTop: 20 } });
  assert.equal(bad.statusCode, 400, 'a measure above the sheet');
  const good = await call(desk, 'put', '/api/admin/institute-certificates/layout', { body: { nameTop: 16, courseTop: 19, hoursTop: 22.6, codeTop: 26 } });
  assert.equal(good.statusCode, 200, JSON.stringify(good.body));
  const back = await call(desk, 'get', '/api/admin/institute-certificates/layout');
  assert.equal(back.body.saved, true);
  assert.equal(back.body.layout.nameTop, 16);
});

test('a wrong certificate is revoked first and then deleted softly; a deleted one is off the desk and cannot be printed', { skip }, async () => {
  const [[cert]] = await pool.query("SELECT id FROM course_completions WHERE tenant_id=? AND subscriber_id='sub-cd-short'", [T]);
  const early = await call(lms, 'delete', '/api/admin/completions/:id', { params: { id: cert.id } });
  assert.equal(early.statusCode, 409, 'a valid certificate is revoked first');
  const revoked = await call(lms, 'post', '/api/admin/completions/:id/revoke', { params: { id: cert.id }, body: { reason: 'اتصدرت بالغلط' } });
  assert.equal(revoked.statusCode, 200, JSON.stringify(revoked.body));
  assert.equal((await call(lms, 'delete', '/api/admin/completions/:id', { params: { id: cert.id } })).statusCode, 200);
  assert.ok((await rowOf(cert.id)).deleted_at, 'the row stays, marked deleted, so the sweep does not issue it again');
  const list = await call(desk, 'get', '/api/admin/institute-certificates');
  assert.ok(!list.body.some(item => item.id === cert.id));
  assert.equal((await call(desk, 'post', '/api/admin/institute-certificates/:id/printed', { params: { id: cert.id }, body: {} })).statusCode, 404);
});
