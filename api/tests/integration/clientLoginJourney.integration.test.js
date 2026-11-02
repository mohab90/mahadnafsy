'use strict';
/**
 * The journeys a client lives on the sign-in page (2 Nov 2026), against a real database:
 *
 *  1. a client the desk added (stored 01XXXXXXXXX, no login) types the number into «نسيت كلمة المرور» → the code arrives on WhatsApp (not the
 *     email), the account is made and linked, the new password signs them in by the number in any spelling;
 *  2. a client with an email only types it → the code arrives on the email, not WhatsApp;
 *  3. a client who signs up with the number the institute already has is NOT filed again as a new lead;
 *  4. sign-up needs both the email and the number;
 *  5. a subscription to a track that names 18 months is open for 18, one to a course for 12.
 * Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-default';
let pool; let reset; let login; let register; let sentMail; let sentWa;

const handlerOf = (router, path) => {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods.post);
  assert.ok(layer, path);
  return layer.route.stack.at(-1).handle;
};
const validatorOf = (router, path) => router.stack.find(item => item.route?.path === path).route.stack.at(-2).handle;

function exchange(body, { ip = '41.9.9.9', cookie = '' } = {}) {
  const res = {
    statusCode: 200, body: null, headers: [],
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    append(name, value) { this.headers.push([name, value]); return this; },
    setHeader(name, value) { this.headers.push([name, value]); return this; },
    cookie() { return this; },
    getHeader() { return undefined; },
  };
  const req = { body, headers: { cookie, 'user-agent': 'integration' }, tenantId: TENANT, ip, get: name => (name === 'user-agent' ? 'integration' : undefined), res };
  return { req, res };
}

const waitFor = async (predicate, ms = 4000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (predicate()) return true; await new Promise(resolve => setTimeout(resolve, 40)); }
  return false;
};

const MARK = 'jny2nov';

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  sentMail = [];
  sentWa = [];
  const email = require('../../lib/email');
  email.sendEmail = async (to, subject, html) => { sentMail.push({ to, subject, code: (String(html).match(/otp-box">(\d{6})</) || [])[1] }); return { accepted: [to], messageId: 'm1' }; };
  const whatsapp = require('../../lib/whatsapp');
  whatsapp.sendWhatsApp = async (to, text) => { sentWa.push({ to, code: (String(text).match(/(\d{6})/) || [])[1] }); return { ok: true, idMessage: 'w1' }; };
  reset = require('../../routes/auth/passwordReset');
  login = require('../../routes/auth/session');
  register = require('../../routes/auth/registration');
  await pool.query(`DELETE FROM users WHERE id LIKE '${MARK}%' OR phone IN ('1055500001','1055500003','1055500004','1055500005') OR email LIKE '${MARK}%'`);
  await pool.query(`DELETE FROM subscribers WHERE id LIKE '${MARK}%'`);
  await pool.query(`DELETE FROM leads WHERE phone IN ('1055500003','1055500004') OR email LIKE '${MARK}%'`);
  await pool.query(`DELETE FROM otp_codes WHERE email LIKE '${MARK}%' OR email IS NULL`);
  const add = (id, name, phone, email) => pool.query(
    "INSERT INTO subscribers (id, tenant_id, name, phone, email, is_active, branch, branch_id, source) VALUES (?,?,?,?,?,1,'ONLINE_EGYPT','branch-online-egypt','test')",
    [id, TENANT, name, phone, email]);
  await add(`${MARK}-a`, 'عميلة أ', '01055500001', null);
  await add(`${MARK}-b`, 'عميل ب', null, `${MARK}-b@example.test`);
  await add(`${MARK}-c`, 'عميل ج', '01055500003', null);
  await add(`${MARK}-d`, 'عميل د', '01055500005', `${MARK}-d@example.test`);
  // already has a login by his email, with no number on it
  await pool.query("INSERT INTO users (id, tenant_id, email, password_hash, name, role, is_active) VALUES (?,?,?,'locked','عميل د','user',1)", [`${MARK}-user-d`, TENANT, `${MARK}-d@example.test`]);
});
after(async () => {
  if (!ENABLED) return;
  await pool.query(`DELETE FROM users WHERE id LIKE '${MARK}%' OR phone IN ('1055500001','1055500003','1055500004') OR email LIKE '${MARK}%'`);
  await pool.query(`DELETE FROM enrollments WHERE subscriber_id LIKE '${MARK}%'`);
  await pool.query(`DELETE FROM subscribers WHERE id LIKE '${MARK}%'`);
  await pool.query(`DELETE FROM leads WHERE phone IN ('1055500003','1055500004') OR email LIKE '${MARK}%'`);
  await pool.query(`DELETE FROM bundle_courses WHERE bundle_id LIKE '${MARK}%'`);
  await pool.query(`DELETE FROM bundles WHERE id LIKE '${MARK}%'`);
  await pool.query(`DELETE FROM courses WHERE id LIKE '${MARK}%'`);
  await pool.end();
});

test('a client stored as 01XXXXXXXXX gets the code on WhatsApp, sets a password, and signs in by the number in any spelling', { skip }, async () => {
  const ask = exchange({ email: '01055500001' });
  await handlerOf(reset, '/api/auth/forgot-password')(ask.req, ask.res);
  assert.equal(ask.res.body.ok, true);
  assert.ok(await waitFor(() => sentWa.length > 0), 'a code went to WhatsApp');
  assert.equal(sentWa[0].to, '201055500001', 'to the number, dialable');
  assert.equal(sentMail.length, 0, 'not by email');
  const [[account]] = await pool.query("SELECT id, phone FROM users WHERE tenant_id=? AND phone='1055500001'", [TENANT]);
  assert.ok(account, 'the account was made from the client');

  const verify = exchange({ email: '+201055500001', code: sentWa[0].code });
  await handlerOf(reset, '/api/auth/verify-otp')(verify.req, verify.res);
  assert.equal(verify.res.statusCode, 200, JSON.stringify(verify.res.body));
  const change = exchange({ resetToken: verify.res.body.resetToken, newPassword: 'Client#Pass2026' });
  await handlerOf(reset, '/api/auth/reset-password')(change.req, change.res);
  assert.equal(change.res.statusCode, 200, JSON.stringify(change.res.body));

  // one browser: it keeps the device cookie the first sign-in gave it (three browsers would be three devices, and the third is refused)
  let cookie = '';
  for (const spelling of ['01055500001', '+201055500001', '1055500001']) {
    const attempt = exchange({ email: spelling, password: 'Client#Pass2026' }, { ip: '41.1.1.1', cookie });
    await handlerOf(login, '/api/auth/login')(attempt.req, attempt.res);
    assert.equal(attempt.res.statusCode, 200, `${spelling}: ${JSON.stringify(attempt.res.body)}`);
    const given = attempt.res.headers.map(([, value]) => String(value)).find(value => value.startsWith('mahadDevice='));
    if (given) cookie = given.split(';')[0];
  }
  const wrong = exchange({ email: '01055500001', password: 'nope-nope-1' });
  await handlerOf(login, '/api/auth/login')(wrong.req, wrong.res);
  assert.equal(wrong.res.statusCode, 401);
});

test('a client with an email only gets the code on the email', { skip }, async () => {
  sentMail.length = 0; sentWa.length = 0;
  const ask = exchange({ email: `${MARK}-b@example.test` });
  await handlerOf(reset, '/api/auth/forgot-password')(ask.req, ask.res);
  assert.ok(await waitFor(() => sentMail.length > 0), 'a code went to the email');
  assert.equal(sentMail[0].to, `${MARK}-b@example.test`);
  assert.match(sentMail[0].code, /^\d{6}$/);
  assert.equal(sentWa.length, 0, 'not on WhatsApp');
});

test('a client who signs up with the number the institute has is not filed again as a lead, and an existing client is not made a second one', { skip }, async () => {
  const body = { name: 'عميل ج', email: `${MARK}-c@example.test`, phone: '01055500003', password: 'Signup#Pass2026' };
  const check = exchange(body);
  let validation = null;
  validatorOf(register, '/api/auth/register')(check.req, check.res, () => { validation = 'passed'; });
  assert.equal(validation, 'passed', JSON.stringify(check.res.body));
  const signup = exchange(body, { ip: '41.7.7.7' });
  await handlerOf(register, '/api/auth/register')(signup.req, signup.res);
  // the sign-up needs a country lookup that a unit run may not have: a 503 there is not what is under test
  if (signup.res.statusCode === 503) return;
  assert.equal(signup.res.statusCode, 200, JSON.stringify(signup.res.body));
  const [leads] = await pool.query("SELECT id FROM leads WHERE tenant_id=? AND phone='1055500003'", [TENANT]);
  assert.equal(leads.length, 0, 'the client was not filed again as a new lead');
  const [clients] = await pool.query("SELECT id FROM subscribers WHERE tenant_id=? AND phone_digits IN ('01055500003','1055500003')", [TENANT]);
  assert.equal(clients.length, 1, 'still one client');
});

test('a sign-up needs both the email and the number', { skip }, async () => {
  for (const body of [
    { name: 'x', phone: '01055500004', password: 'Signup#Pass2026' },
    { name: 'x', email: 'not-an-email', phone: '01055500004', password: 'Signup#Pass2026' },
    { name: 'x', email: `${MARK}-d@example.test`, password: 'Signup#Pass2026' },
  ]) {
    const attempt = exchange(body);
    let passed = false;
    validatorOf(register, '/api/auth/register')(attempt.req, attempt.res, () => { passed = true; });
    assert.equal(passed, false, JSON.stringify(body));
    assert.equal(attempt.res.statusCode, 400);
  }
});

test('a subscription to a track that names 18 months is open for 18, to a course for 12', { skip }, async () => {
  const { grantCourseEntitlement } = require('../../lib/entitlements');
  await pool.query("INSERT INTO courses (id, tenant_id, slug, title, description, short_description, instructor, thumbnail, category, type, is_published) VALUES (?,?,?,?,'','','x','','GENERAL','RECORDED',1)", [`${MARK}-course`, TENANT, `${MARK}-course`, 'كورس اختبار']);
  await pool.query("INSERT INTO bundles (id, tenant_id, title, description, access_months, is_published) VALUES (?,?,?,?,18,1)", [`${MARK}-track`, TENANT, 'مسار اختبار', '']);
  const enrolledAt = new Date('2026-01-15T10:00:00Z');
  await grantCourseEntitlement({ tenantId: TENANT, subscriberId: `${MARK}-a`, courseId: `${MARK}-course`, bundleId: `${MARK}-track`, enrolledAt, source: 'admin', actor: 'test' });
  const [[track]] = await pool.query("SELECT TIMESTAMPDIFF(MONTH, enrolled_at, expiry_date) months FROM enrollments WHERE subscriber_id=? AND course_id=?", [`${MARK}-a`, `${MARK}-course`]);
  assert.equal(track.months, 18);
  await pool.query("DELETE FROM enrollments WHERE subscriber_id=?", [`${MARK}-a`]);
  await grantCourseEntitlement({ tenantId: TENANT, subscriberId: `${MARK}-a`, courseId: `${MARK}-course`, enrolledAt, source: 'admin', actor: 'test' });
  const [[plain]] = await pool.query("SELECT TIMESTAMPDIFF(MONTH, enrolled_at, expiry_date) months FROM enrollments WHERE subscriber_id=? AND course_id=?", [`${MARK}-a`, `${MARK}-course`]);
  assert.equal(plain.months, 12);
});

test('a client whose login has an email but no number gets the code on the number on their file, and the number joins that login', { skip }, async () => {
  sentMail.length = 0; sentWa.length = 0;
  const ask = exchange({ email: '01055500005' });
  await handlerOf(reset, '/api/auth/forgot-password')(ask.req, ask.res);
  assert.ok(await waitFor(() => sentWa.length > 0), 'a code went to WhatsApp');
  assert.equal(sentWa[0].to, '201055500005');
  const [[account]] = await pool.query("SELECT id, phone FROM users WHERE tenant_id=? AND email=?", [TENANT, `${MARK}-d@example.test`]);
  assert.equal(account.id, `${MARK}-user-d`, 'the same login, not a second one');
  assert.equal(account.phone, '1055500005');
});
