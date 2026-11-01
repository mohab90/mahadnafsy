'use strict';
/**
 * An employee changes their own email and photo (1 Nov 2026). The email moves only after the new address returns a code mailed to it and
 * the current password is given; another account's address is refused; the photo is stored and linked on the row. Runs only with DB_*.
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
let pool; let router; let sent;

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function call(method, path, body, uid = 'u-self-1', email = 'self1@example.test') {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, path);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  await layer.route.stack.at(-1).handle({ params: {}, query: {}, body, headers: {}, tenantId: TENANT, user: { uid, email, tenant_id: TENANT }, ip: '127.0.0.1', get: () => undefined }, res);
  return res;
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  const email = require('../../lib/email');
  sent = [];
  email.sendEmail = async (to, subject, html) => { sent.push({ to, subject, code: (String(html).match(/otp-box">(\d{6})</) || [])[1] }); return { accepted: [to] }; };
  router = require('../../routes/auth/profile');
  const hash = await require('../../lib/passwordHash').hash('Self#Pass2026');
  await pool.query("DELETE FROM users WHERE id IN ('u-self-1','u-self-2')");
  await pool.query("DELETE FROM staff WHERE id IN ('st-self-1','st-self-2')");
  await pool.query("INSERT INTO users (id, tenant_id, email, password_hash, name, role, is_active, session_version) VALUES ('u-self-1',?,?,?,'موظف 1','staff',1,1),('u-self-2',?,?,?,'موظف 2','staff',1,1)", [TENANT, 'self1@example.test', hash, TENANT, 'self2@example.test', hash]);
  await pool.query("INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES ('st-self-1',?,'موظف 1','self1@example.test','0100','SALES',1,NOW()),('st-self-2',?,'موظف 2','self2@example.test','0101','SALES',1,NOW())", [TENANT, TENANT]);
});
after(async () => {
  if (!ENABLED) return;
  await pool.query("DELETE FROM users WHERE id IN ('u-self-1','u-self-2')");
  await pool.query("DELETE FROM staff WHERE id IN ('st-self-1','st-self-2')");
  await pool.query("DELETE FROM login_email_codes WHERE user_id LIKE 'email-change:u-self-%'");
  await pool.end();
});

test('the email needs the current password, a valid address, and one nobody else uses', { skip }, async () => {
  assert.equal((await call('post', '/api/staff/me/email/request', { newEmail: 'new1@example.test', currentPassword: 'wrong' })).statusCode, 401);
  assert.equal((await call('post', '/api/staff/me/email/request', { newEmail: 'not-an-email', currentPassword: 'Self#Pass2026' })).statusCode, 400);
  assert.equal((await call('post', '/api/staff/me/email/request', { newEmail: 'self2@example.test', currentPassword: 'Self#Pass2026' })).body.code, 'EMAIL_TAKEN');
  assert.equal((await call('post', '/api/staff/me/email/request', { newEmail: 'self1@example.test', currentPassword: 'Self#Pass2026' })).body.code, 'SAME_EMAIL');
  assert.equal(sent.length, 0, 'nothing was mailed for any of those');
});

test('the code goes to the NEW address and changes the login and the employee record', { skip }, async () => {
  const ask = await call('post', '/api/staff/me/email/request', { newEmail: 'New1@Example.test', currentPassword: 'Self#Pass2026' });
  assert.equal(ask.statusCode, 200, JSON.stringify(ask.body));
  assert.equal(sent.at(-1).to, 'new1@example.test');
  const code = sent.at(-1).code;
  assert.match(code, /^\d{6}$/);
  assert.equal((await call('post', '/api/staff/me/email/confirm', { newEmail: 'new1@example.test', code: '000000' })).body.code, 'CODE_WRONG');
  assert.equal((await call('post', '/api/staff/me/email/confirm', { newEmail: 'other@example.test', code })).body.code, 'CODE_EXPIRED', 'a code confirms the address it was mailed to');
  const done = await call('post', '/api/staff/me/email/confirm', { newEmail: 'new1@example.test', code });
  assert.equal(done.statusCode, 200, JSON.stringify(done.body));
  const [[user]] = await pool.query("SELECT email FROM users WHERE id='u-self-1'");
  const [[staff]] = await pool.query("SELECT email FROM staff WHERE id='st-self-1'");
  assert.equal(user.email, 'new1@example.test');
  assert.equal(staff.email, 'new1@example.test');
  assert.equal((await call('post', '/api/staff/me/email/confirm', { newEmail: 'new1@example.test', code }, 'u-self-1', 'new1@example.test')).statusCode, 400, 'a code is used once');
});

test('someone who is not an employee cannot use it', { skip }, async () => {
  const res = await call('post', '/api/staff/me/email/request', { newEmail: 'x@example.test', currentPassword: 'x' }, 'u-nobody', 'nobody@example.test');
  assert.equal(res.statusCode, 403);
});

test('the photo is stored and linked on the employee\'s row, and can be removed', { skip }, async () => {
  const bad = await call('post', '/api/staff/me/photo', { dataUrl: 'data:text/plain;base64,aGVsbG8=' }, 'u-self-2', 'self2@example.test');
  assert.equal(bad.statusCode, 400);
  const ok = await call('post', '/api/staff/me/photo', { dataUrl: PNG }, 'u-self-2', 'self2@example.test');
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.match(ok.body.image, /^\/api\/media\/tenant-default\/[a-f0-9]{24}\.webp$/);
  const [[row]] = await pool.query("SELECT image FROM staff WHERE id='st-self-2'");
  assert.equal(row.image, ok.body.image);
  await call('post', '/api/staff/me/photo', { remove: true }, 'u-self-2', 'self2@example.test');
  const [[gone]] = await pool.query("SELECT image FROM staff WHERE id='st-self-2'");
  assert.equal(gone.image, null);
});
